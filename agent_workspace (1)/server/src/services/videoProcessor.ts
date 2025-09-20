import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { prisma } from './database';
import { redis } from './redis';
import { search } from './elasticsearch';
import logger from '../utils/logger';
import AWS from 'aws-sdk';

const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);
const access = promisify(fs.access);

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION || 'us-east-1',
});

const s3 = new AWS.S3();

interface VideoProcessingJob {
  videoId: string;
  inputPath: string;
  originalFilename: string;
}

const VIDEO_QUALITIES = [
  { name: '144p', width: 256, height: 144, bitrate: '200k' },
  { name: '360p', width: 640, height: 360, bitrate: '800k' },
  { name: '480p', width: 854, height: 480, bitrate: '1200k' },
  { name: '720p', width: 1280, height: 720, bitrate: '2500k' },
  { name: '1080p', width: 1920, height: 1080, bitrate: '4500k' },
  { name: '1440p', width: 2560, height: 1440, bitrate: '8000k' },
  { name: '2160p', width: 3840, height: 2160, bitrate: '15000k' },
];

export const startVideoProcessor = () => {
  logger.info('Starting video processor...');
  
  // Process videos from Redis queue
  processVideoQueue();
  
  // Process every 30 seconds
  setInterval(processVideoQueue, 30000);
};

const processVideoQueue = async () => {
  try {
    const job = await redis.lPop('video-processing-queue');
    
    if (job) {
      const jobData: VideoProcessingJob = JSON.parse(job);
      await processVideo(jobData);
    }
  } catch (error) {
    logger.error('Video queue processing error:', error);
  }
};

export const addVideoToQueue = async (videoData: VideoProcessingJob) => {
  try {
    await redis.rPush('video-processing-queue', JSON.stringify(videoData));
    logger.info(`Added video ${videoData.videoId} to processing queue`);
  } catch (error) {
    logger.error('Failed to add video to queue:', error);
  }
};

const processVideo = async (job: VideoProcessingJob) => {
  const { videoId, inputPath, originalFilename } = job;
  
  try {
    logger.info(`Processing video: ${videoId}`);
    
    // Update video status to processing
    await prisma.video.update({
      where: { id: videoId },
      data: { status: 'PROCESSING' },
    });

    // Get video metadata
    const metadata = await getVideoMetadata(inputPath);
    const duration = Math.floor(metadata.format.duration || 0);
    
    // Create output directory
    const outputDir = path.join(process.env.VIDEO_PROCESSED_PATH || './processed/videos', videoId);
    await mkdir(outputDir, { recursive: true });

    // Generate thumbnail
    const thumbnailPath = path.join(outputDir, 'thumbnail.jpg');
    await generateThumbnail(inputPath, thumbnailPath);
    
    // Upload thumbnail to S3
    const thumbnailUrl = await uploadToS3(thumbnailPath, `thumbnails/${videoId}/thumbnail.jpg`);

    // Process multiple qualities
    const processedFiles: Record<string, string> = {};
    const hlsPlaylists: string[] = [];
    
    for (const quality of VIDEO_QUALITIES) {
      try {
        // Skip if original resolution is lower than target
        if (metadata.streams[0].height < quality.height) {
          continue;
        }

        const outputPath = path.join(outputDir, `${quality.name}.mp4`);
        const hlsPath = path.join(outputDir, `${quality.name}.m3u8`);
        
        // Transcode video
        await transcodeVideo(inputPath, outputPath, quality);
        
        // Generate HLS playlist
        await generateHLS(outputPath, hlsPath, quality);
        
        // Upload to S3
        const mp4Url = await uploadToS3(outputPath, `videos/${videoId}/${quality.name}.mp4`);
        const hlsUrl = await uploadToS3(hlsPath, `videos/${videoId}/${quality.name}.m3u8`);
        
        processedFiles[quality.name] = mp4Url;
        hlsPlaylists.push(hlsUrl);
        
        // Clean up local files
        await unlink(outputPath);
        await unlink(hlsPath);
        
        logger.info(`Processed ${quality.name} for video ${videoId}`);
      } catch (error) {
        logger.error(`Failed to process ${quality.name} for video ${videoId}:`, error);
      }
    }

    // Generate master HLS playlist
    const masterPlaylistPath = path.join(outputDir, 'master.m3u8');
    await generateMasterHLS(masterPlaylistPath, VIDEO_QUALITIES.filter(q => processedFiles[q.name]));
    const masterPlaylistUrl = await uploadToS3(masterPlaylistPath, `videos/${videoId}/master.m3u8`);

    // Update video in database
    const updatedVideo = await prisma.video.update({
      where: { id: videoId },
      data: {
        status: 'PUBLISHED',
        duration,
        thumbnail: thumbnailUrl,
        processedFiles,
        hlsPlaylist: masterPlaylistUrl,
      },
      include: {
        channel: true,
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
          },
        },
      },
    });

    // Index video in Elasticsearch
    await search.indexVideo({
      id: updatedVideo.id,
      title: updatedVideo.title,
      description: updatedVideo.description,
      tags: updatedVideo.tags,
      category: updatedVideo.category,
      channelId: updatedVideo.channelId,
      channelName: updatedVideo.channel.name,
      views: updatedVideo.views,
      likes: updatedVideo.likes,
      duration: updatedVideo.duration,
      createdAt: updatedVideo.createdAt,
      thumbnail: updatedVideo.thumbnail,
      privacy: updatedVideo.privacy,
      status: updatedVideo.status,
    });

    // Clean up original file
    await unlink(inputPath);
    
    // Clean up thumbnail
    await unlink(thumbnailPath);
    
    logger.info(`Successfully processed video: ${videoId}`);
    
    // Send notification to user
    await prisma.notification.create({
      data: {
        title: 'Video processed successfully',
        message: `Your video "${updatedVideo.title}" has been processed and is now live!`,
        type: 'VIDEO_UPLOAD',
        userId: updatedVideo.userId,
        data: {
          videoId: updatedVideo.id,
          thumbnail: updatedVideo.thumbnail,
        },
      },
    });
    
  } catch (error) {
    logger.error(`Failed to process video ${videoId}:`, error);
    
    // Update video status to failed
    await prisma.video.update({
      where: { id: videoId },
      data: { status: 'FAILED' },
    });
    
    // Send error notification
    const video = await prisma.video.findUnique({ where: { id: videoId } });
    if (video) {
      await prisma.notification.create({
        data: {
          title: 'Video processing failed',
          message: `Failed to process your video "${video.title}". Please try uploading again.`,
          type: 'VIDEO_UPLOAD',
          userId: video.userId,
          data: {
            videoId: video.id,
            error: 'Processing failed',
          },
        },
      });
    }
  }
};

const getVideoMetadata = (inputPath: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata);
    });
  });
};

const generateThumbnail = (inputPath: string, outputPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        timestamps: ['10%'],
        filename: 'thumbnail.jpg',
        folder: path.dirname(outputPath),
        size: '1280x720',
      })
      .on('end', () => resolve())
      .on('error', reject);
  });
};

const transcodeVideo = (inputPath: string, outputPath: string, quality: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .size(`${quality.width}x${quality.height}`)
      .videoBitrate(quality.bitrate)
      .audioCodec('aac')
      .videoCodec('libx264')
      .addOptions([
        '-preset fast',
        '-crf 23',
        '-movflags +faststart',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
};

const generateHLS = (inputPath: string, outputPath: string, quality: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .addOptions([
        '-hls_time 10',
        '-hls_list_size 0',
        '-hls_segment_filename', path.join(path.dirname(outputPath), `${quality.name}_%03d.ts`),
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
};

const generateMasterHLS = async (outputPath: string, qualities: any[]): Promise<void> => {
  const content = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    ...qualities.map(q => [
      `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(q.bitrate) * 1000},RESOLUTION=${q.width}x${q.height}`,
      `${q.name}.m3u8`,
    ]).flat(),
  ].join('\n');
  
  fs.writeFileSync(outputPath, content);
};

const uploadToS3 = async (filePath: string, key: string): Promise<string> => {
  try {
    const fileContent = fs.readFileSync(filePath);
    
    const params = {
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: key,
      Body: fileContent,
      ContentType: getContentType(filePath),
    };
    
    const result = await s3.upload(params).promise();
    return result.Location;
  } catch (error) {
    logger.error('S3 upload error:', error);
    throw error;
  }
};

const getContentType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  
  switch (ext) {
    case '.mp4': return 'video/mp4';
    case '.m3u8': return 'application/vnd.apple.mpegurl';
    case '.ts': return 'video/mp2t';
    case '.jpg': return 'image/jpeg';
    case '.png': return 'image/png';
    default: return 'application/octet-stream';
  }
};

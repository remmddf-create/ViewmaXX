import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { uploadToS3 } from './s3';
import { redis } from './redis';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

// Video quality configurations
const VIDEO_QUALITIES = [
  { name: '144p', height: 144, bitrate: '95k', audioBitrate: '48k' },
  { name: '240p', height: 240, bitrate: '150k', audioBitrate: '64k' },
  { name: '360p', height: 360, bitrate: '276k', audioBitrate: '64k' },
  { name: '480p', height: 480, bitrate: '750k', audioBitrate: '96k' },
  { name: '720p', height: 720, bitrate: '2500k', audioBitrate: '128k' },
  { name: '1080p', height: 1080, bitrate: '4500k', audioBitrate: '128k' },
  { name: '1440p', height: 1440, bitrate: '9000k', audioBitrate: '192k' },
  { name: '2160p', height: 2160, bitrate: '20000k', audioBitrate: '192k' },
];

export const setupVideoProcessing = async () => {
  try {
    // Set FFmpeg path if specified in environment
    if (process.env.FFMPEG_PATH) {
      ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
    }
    if (process.env.FFPROBE_PATH) {
      ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);
    }

    console.log('✅ Video processing setup complete');
  } catch (error) {
    console.error('❌ Video processing setup failed:', error);
    throw error;
  }
};

// Get video metadata
export const getVideoMetadata = (inputPath: string): Promise<ffmpeg.FfprobeData> => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata);
      }
    });
  });
};

// Generate video thumbnail
export const generateThumbnail = async (inputPath: string, outputPath: string, timeOffset: number = 10): Promise<string> => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        timestamps: [timeOffset],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '1280x720',
      })
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        reject(err);
      });
  });
};

// Generate multiple thumbnails
export const generateMultipleThumbnails = async (inputPath: string, outputDir: string, count: number = 3): Promise<string[]> => {
  try {
    const metadata = await getVideoMetadata(inputPath);
    const duration = metadata.format?.duration || 0;
    const interval = duration / (count + 1);
    
    const thumbnailPaths: string[] = [];
    
    for (let i = 1; i <= count; i++) {
      const timestamp = interval * i;
      const outputPath = path.join(outputDir, `thumbnail_${i}.jpg`);
      
      await generateThumbnail(inputPath, outputPath, timestamp);
      thumbnailPaths.push(outputPath);
    }
    
    return thumbnailPaths;
  } catch (error) {
    console.error('Generate multiple thumbnails error:', error);
    throw error;
  }
};

// Transcode video to multiple qualities
export const transcodeVideo = async (
  inputPath: string,
  outputDir: string,
  progressCallback?: (progress: number) => void
): Promise<{ qualities: any[], manifestPath: string }> => {
  try {
    const metadata = await getVideoMetadata(inputPath);
    const inputHeight = metadata.streams?.[0]?.height || 0;
    
    // Filter qualities based on input resolution
    const applicableQualities = VIDEO_QUALITIES.filter(q => q.height <= inputHeight);
    
    const qualities: any[] = [];
    const manifestLines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];
    
    // Process each quality
    for (const quality of applicableQualities) {
      const outputPath = path.join(outputDir, `${quality.name}.m3u8`);
      const segmentPattern = path.join(outputDir, `${quality.name}_%03d.ts`);
      
      await new Promise((resolve, reject) => {
        let progress = 0;
        
        ffmpeg(inputPath)
          .outputOptions([
            '-c:v libx264',
            '-c:a aac',
            `-b:v ${quality.bitrate}`,
            `-b:a ${quality.audioBitrate}`,
            `-vf scale=-2:${quality.height}`,
            '-preset fast',
            '-hls_time 10',
            '-hls_list_size 0',
            '-hls_segment_filename', segmentPattern,
            '-f hls',
          ])
          .output(outputPath)
          .on('progress', (info) => {
            progress = info.percent || 0;
            progressCallback?.(progress);
          })
          .on('end', () => {
            resolve(outputPath);
          })
          .on('error', (err) => {
            reject(err);
          })
          .run();
      });
      
      qualities.push({
        resolution: quality.name,
        url: `${quality.name}.m3u8`,
        bitrate: parseInt(quality.bitrate.replace('k', '')) * 1000,
        height: quality.height,
      });
      
      // Add to master manifest
      manifestLines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(quality.bitrate.replace('k', '')) * 1000},RESOLUTION=${Math.round(quality.height * 16/9)}x${quality.height}`,
        `${quality.name}.m3u8`
      );
    }
    
    // Create master manifest
    const manifestPath = path.join(outputDir, 'master.m3u8');
    fs.writeFileSync(manifestPath, manifestLines.join('\n'));
    
    return { qualities, manifestPath };
  } catch (error) {
    console.error('Video transcoding error:', error);
    throw error;
  }
};

// Process uploaded video
export const processVideo = async (videoId: string, s3Key: string): Promise<void> => {
  try {
    console.log(`Starting video processing for ${videoId}`);
    
    // Update video status
    await prisma.video.update({
      where: { id: videoId },
      data: { status: 'processing' },
    });
    
    // Download video from S3 to temporary location
    const tempDir = `/tmp/video_${videoId}`;
    const inputPath = path.join(tempDir, 'input.mp4');
    const outputDir = path.join(tempDir, 'output');
    
    // Create directories
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
    
    // Download from S3 (simplified - in production, use streaming)
    // For now, assume file is already accessible
    
    // Get video metadata
    const metadata = await getVideoMetadata(inputPath);
    const duration = metadata.format?.duration || 0;
    
    // Generate thumbnail
    const thumbnailPath = path.join(tempDir, 'thumbnail.jpg');
    await generateThumbnail(inputPath, thumbnailPath);
    
    // Upload thumbnail to S3
    const thumbnailS3Key = `thumbnails/${videoId}/thumbnail.jpg`;
    const thumbnailUpload = await uploadToS3(thumbnailPath, thumbnailS3Key, 'image/jpeg');
    
    // Transcode video
    const transcodeResult = await transcodeVideo(outputDir, inputPath, (progress) => {
      // Update progress in Redis
      redis.setex(`video_progress:${videoId}`, 3600, JSON.stringify({
        status: 'transcoding',
        progress: Math.round(progress),
      }));
    });
    
    // Upload transcoded files to S3
    const videoQualities = [];
    for (const quality of transcodeResult.qualities) {
      const qualityDir = path.join(outputDir, quality.resolution);
      const files = fs.readdirSync(qualityDir);
      
      for (const file of files) {
        const filePath = path.join(qualityDir, file);
        const s3Key = `videos/${videoId}/${quality.resolution}/${file}`;
        await uploadToS3(filePath, s3Key, file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T');
      }
      
      videoQualities.push({
        resolution: quality.resolution,
        url: `https://${process.env.S3_BUCKET}.s3.amazonaws.com/videos/${videoId}/${quality.resolution}/${quality.resolution}.m3u8`,
        bitrate: quality.bitrate,
        format: 'hls',
      });
    }
    
    // Upload master manifest
    const masterManifestS3Key = `videos/${videoId}/master.m3u8`;
    await uploadToS3(transcodeResult.manifestPath, masterManifestS3Key, 'application/x-mpegURL');
    
    // Update video record
    await prisma.video.update({
      where: { id: videoId },
      data: {
        status: 'published',
        duration: Math.round(duration),
        thumbnail: thumbnailUpload.Location,
        videoUrl: `https://${process.env.S3_BUCKET}.s3.amazonaws.com/videos/${videoId}/master.m3u8`,
        quality: videoQualities,
        processedAt: new Date(),
      },
    });
    
    // Clean up temporary files
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    // Update progress
    await redis.setex(`video_progress:${videoId}`, 3600, JSON.stringify({
      status: 'completed',
      progress: 100,
    }));
    
    console.log(`Video processing completed for ${videoId}`);
  } catch (error) {
    console.error(`Video processing failed for ${videoId}:`, error);
    
    // Update video status to failed
    await prisma.video.update({
      where: { id: videoId },
      data: {
        status: 'failed',
        processedAt: new Date(),
      },
    });
    
    // Update progress
    await redis.setex(`video_progress:${videoId}`, 3600, JSON.stringify({
      status: 'failed',
      progress: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    }));
    
    throw error;
  }
};

// Extract video frames for analysis
export const extractFrames = async (
  inputPath: string,
  outputDir: string,
  count: number = 10
): Promise<string[]> => {
  try {
    const metadata = await getVideoMetadata(inputPath);
    const duration = metadata.format?.duration || 0;
    const interval = duration / count;
    
    const framesPaths: string[] = [];
    
    for (let i = 0; i < count; i++) {
      const timestamp = interval * i;
      const outputPath = path.join(outputDir, `frame_${i.toString().padStart(3, '0')}.jpg`);
      
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .seekInput(timestamp)
          .frames(1)
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      
      framesPaths.push(outputPath);
    }
    
    return framesPaths;
  } catch (error) {
    console.error('Extract frames error:', error);
    throw error;
  }
};

// Convert video to different format
export const convertVideo = async (
  inputPath: string,
  outputPath: string,
  options: {
    format?: string;
    codec?: string;
    bitrate?: string;
    resolution?: string;
  } = {}
): Promise<string> => {
  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath);
    
    if (options.codec) {
      command = command.videoCodec(options.codec);
    }
    
    if (options.bitrate) {
      command = command.videoBitrate(options.bitrate);
    }
    
    if (options.resolution) {
      command = command.size(options.resolution);
    }
    
    command
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
};

// Generate video preview (short clip)
export const generatePreview = async (
  inputPath: string,
  outputPath: string,
  startTime: number = 10,
  duration: number = 30
): Promise<string> => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(startTime)
      .duration(duration)
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
};

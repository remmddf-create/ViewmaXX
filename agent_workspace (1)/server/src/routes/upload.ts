import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { uploadToS3, generatePresignedUrl } from '../services/s3';
import { processVideo, generateThumbnail } from '../services/videoProcessing';
import { redis } from '../services/redis';
import path from 'path';

const router = Router();
const prisma = new PrismaClient();

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/',
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-ms-wmv',
      'video/x-matroska',
      'image/jpeg',
      'image/png',
      'image/webp',
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  },
});

const videoMetadataSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  category: z.string().min(1),
  tags: z.array(z.string()).max(10).optional(),
  visibility: z.enum(['public', 'unlisted', 'private']).default('public'),
});

// Get presigned URL for direct upload to S3
router.post('/presigned-url', authMiddleware, async (req, res) => {
  try {
    const { filename, contentType, fileSize } = req.body;
    const userId = req.userId!;

    if (!filename || !contentType) {
      return res.status(400).json({ error: 'Filename and content type required' });
    }

    // Validate file size (2GB limit)
    if (fileSize > 2 * 1024 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size exceeds 2GB limit' });
    }

    // Validate content type
    const allowedTypes = [
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-ms-wmv',
      'video/x-matroska',
    ];

    if (!allowedTypes.includes(contentType)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    // Generate unique filename
    const fileExtension = path.extname(filename);
    const uniqueFilename = `${userId}/${uuidv4()}${fileExtension}`;
    const key = `uploads/videos/${uniqueFilename}`;

    // Generate presigned URL
    const presignedUrl = await generatePresignedUrl(key, contentType);

    // Store upload session in Redis
    const uploadId = uuidv4();
    await redis.setex(`upload:${uploadId}`, 3600, JSON.stringify({
      userId,
      key,
      filename,
      contentType,
      fileSize,
      status: 'pending',
    }));

    res.json({
      uploadId,
      presignedUrl,
      key,
    });
  } catch (error) {
    console.error('Presigned URL error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Confirm upload and create video record
router.post('/confirm', authMiddleware, validateRequest(videoMetadataSchema), async (req, res) => {
  try {
    const { uploadId, ...videoData } = req.body;
    const userId = req.userId!;

    if (!uploadId) {
      return res.status(400).json({ error: 'Upload ID required' });
    }

    // Get upload session from Redis
    const uploadSession = await redis.get(`upload:${uploadId}`);
    if (!uploadSession) {
      return res.status(400).json({ error: 'Invalid or expired upload session' });
    }

    const session = JSON.parse(uploadSession);
    if (session.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get user's channel
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { channelId: true },
    });

    if (!user?.channelId) {
      return res.status(400).json({ error: 'User channel not found' });
    }

    // Create video record
    const video = await prisma.video.create({
      data: {
        id: uuidv4(),
        title: videoData.title,
        description: videoData.description || '',
        category: videoData.category,
        tags: videoData.tags || [],
        visibility: videoData.visibility,
        status: 'processing',
        videoUrl: `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${session.key}`,
        thumbnail: '', // Will be generated during processing
        duration: 0, // Will be set during processing
        userId,
        channelId: user.channelId,
      },
    });

    // Start video processing
    await processVideo(video.id, session.key);

    // Clean up upload session
    await redis.del(`upload:${uploadId}`);

    res.status(201).json({
      message: 'Video uploaded successfully and is being processed',
      videoId: video.id,
      status: 'processing',
    });
  } catch (error) {
    console.error('Upload confirm error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload video using multipart (fallback method)
router.post('/video', authMiddleware, upload.single('video'), async (req, res) => {
  try {
    const file = req.file;
    const userId = req.userId!;

    if (!file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    // Validate file
    const allowedMimes = [
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-ms-wmv',
      'video/x-matroska',
    ];

    if (!allowedMimes.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Invalid video format' });
    }

    // Generate unique filename
    const fileExtension = path.extname(file.originalname);
    const uniqueFilename = `${userId}/${uuidv4()}${fileExtension}`;
    const key = `uploads/videos/${uniqueFilename}`;

    // Upload to S3
    const uploadResult = await uploadToS3(file.path, key, file.mimetype);

    res.json({
      message: 'Video uploaded successfully',
      key: uploadResult.Key,
      url: uploadResult.Location,
    });
  } catch (error) {
    console.error('Video upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload thumbnail
router.post('/thumbnail', authMiddleware, upload.single('thumbnail'), async (req, res) => {
  try {
    const file = req.file;
    const { videoId } = req.body;
    const userId = req.userId!;

    if (!file) {
      return res.status(400).json({ error: 'No thumbnail file provided' });
    }

    if (!videoId) {
      return res.status(400).json({ error: 'Video ID required' });
    }

    // Validate file
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Invalid image format' });
    }

    // Check if user owns the video
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { userId: true },
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (video.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Generate unique filename
    const fileExtension = path.extname(file.originalname);
    const uniqueFilename = `${userId}/${videoId}/thumbnail${fileExtension}`;
    const key = `uploads/thumbnails/${uniqueFilename}`;

    // Upload to S3
    const uploadResult = await uploadToS3(file.path, key, file.mimetype);

    // Update video record
    await prisma.video.update({
      where: { id: videoId },
      data: { thumbnail: uploadResult.Location },
    });

    res.json({
      message: 'Thumbnail uploaded successfully',
      thumbnailUrl: uploadResult.Location,
    });
  } catch (error) {
    console.error('Thumbnail upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get upload progress
router.get('/progress/:uploadId', authMiddleware, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const userId = req.userId!;

    // Get upload progress from Redis
    const progressData = await redis.get(`progress:${uploadId}`);
    if (!progressData) {
      return res.status(404).json({ error: 'Upload progress not found' });
    }

    const progress = JSON.parse(progressData);
    if (progress.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(progress);
  } catch (error) {
    console.error('Get upload progress error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel upload
router.delete('/cancel/:uploadId', authMiddleware, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const userId = req.userId!;

    // Get upload session
    const uploadSession = await redis.get(`upload:${uploadId}`);
    if (!uploadSession) {
      return res.status(404).json({ error: 'Upload session not found' });
    }

    const session = JSON.parse(uploadSession);
    if (session.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Clean up Redis data
    await redis.del(`upload:${uploadId}`);
    await redis.del(`progress:${uploadId}`);

    // TODO: Cancel S3 multipart upload if in progress

    res.json({ message: 'Upload cancelled successfully' });
  } catch (error) {
    console.error('Cancel upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

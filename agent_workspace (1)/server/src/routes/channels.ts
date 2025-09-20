import express from 'express';
import { body, validationResult, query } from 'express-validator';
import multer from 'multer';
import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../services/database';
import { cache } from '../services/redis';
import { search } from '../services/elasticsearch';
import logger from '../utils/logger';

const router = express.Router();

// Configure AWS S3
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION || 'us-east-1',
});

const s3 = new AWS.S3();

// Configure multer for image upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

const uploadToS3 = async (file: Express.Multer.File, folder: string): Promise<string> => {
  const key = `${folder}/${uuidv4()}-${file.originalname}`;
  
  const params = {
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: 'public-read',
  };
  
  const result = await s3.upload(params).promise();
  return result.Location;
};

// @route   GET /api/channels/:id
// @desc    Get channel by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check cache first
    const cacheKey = `channel:${id}`;
    const cachedChannel = await cache.get(cacheKey);
    if (cachedChannel) {
      return res.json(cachedChannel);
    }

    const channel = await prisma.channel.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            isVerified: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            subscriptions: true,
            videos: true,
          },
        },
      },
    });

    if (!channel || !channel.isActive) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Get recent videos
    const recentVideos = await prisma.video.findMany({
      where: {
        channelId: id,
        status: 'PUBLISHED',
        privacy: 'PUBLIC',
      },
      select: {
        id: true,
        title: true,
        thumbnail: true,
        duration: true,
        views: true,
        createdAt: true,
      },
      take: 6,
      orderBy: { createdAt: 'desc' },
    });

    const result = {
      ...channel,
      recentVideos,
      subscriberCount: channel._count.subscriptions,
      videoCount: channel._count.videos,
    };

    // Cache for 5 minutes
    await cache.set(cacheKey, result, 300);

    res.json(result);
  } catch (error) {
    logger.error('Get channel error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   PUT /api/channels/:id
// @desc    Update channel
// @access  Private
router.put(
  '/:id',
  authenticate,
  [
    body('name').optional().isLength({ min: 1, max: 50 }).trim(),
    body('description').optional().isLength({ max: 1000 }).trim(),
  ],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { name, description } = req.body;
      const userId = req.user!.id;

      // Check if user owns the channel
      const channel = await prisma.channel.findUnique({
        where: { id },
        select: { userId: true },
      });

      if (!channel || channel.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Update channel
      const updatedChannel = await prisma.channel.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description && { description }),
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              isVerified: true,
            },
          },
          _count: {
            select: {
              subscriptions: true,
              videos: true,
            },
          },
        },
      });

      // Update in Elasticsearch
      await search.indexChannel({
        id: updatedChannel.id,
        name: updatedChannel.name,
        description: updatedChannel.description,
        userId: updatedChannel.userId,
        subscriberCount: updatedChannel._count.subscriptions,
        videoCount: updatedChannel._count.videos,
        createdAt: updatedChannel.createdAt,
        isVerified: updatedChannel.isVerified,
      });

      // Clear cache
      await cache.del(`channel:${id}`);

      logger.info(`Channel updated: ${id} by user ${userId}`);
      res.json({
        message: 'Channel updated successfully',
        channel: updatedChannel,
      });
    } catch (error) {
      logger.error('Update channel error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   POST /api/channels/:id/avatar
// @desc    Upload channel avatar
// @access  Private
router.post(
  '/:id/avatar',
  authenticate,
  upload.single('avatar'),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Check if user owns the channel
      const channel = await prisma.channel.findUnique({
        where: { id },
        select: { userId: true },
      });

      if (!channel || channel.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const avatarUrl = await uploadToS3(req.file, 'channel-avatars');

      const updatedChannel = await prisma.channel.update({
        where: { id },
        data: { avatar: avatarUrl },
        select: {
          id: true,
          name: true,
          avatar: true,
          banner: true,
          description: true,
        },
      });

      // Clear cache
      await cache.del(`channel:${id}`);

      logger.info(`Channel avatar updated: ${id}`);
      res.json({
        message: 'Avatar updated successfully',
        channel: updatedChannel,
      });
    } catch (error) {
      logger.error('Upload channel avatar error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   POST /api/channels/:id/banner
// @desc    Upload channel banner
// @access  Private
router.post(
  '/:id/banner',
  authenticate,
  upload.single('banner'),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Check if user owns the channel
      const channel = await prisma.channel.findUnique({
        where: { id },
        select: { userId: true },
      });

      if (!channel || channel.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const bannerUrl = await uploadToS3(req.file, 'channel-banners');

      const updatedChannel = await prisma.channel.update({
        where: { id },
        data: { banner: bannerUrl },
        select: {
          id: true,
          name: true,
          avatar: true,
          banner: true,
          description: true,
        },
      });

      // Clear cache
      await cache.del(`channel:${id}`);

      logger.info(`Channel banner updated: ${id}`);
      res.json({
        message: 'Banner updated successfully',
        channel: updatedChannel,
      });
    } catch (error) {
      logger.error('Upload channel banner error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   GET /api/channels/:id/videos
// @desc    Get channel videos
// @access  Public
router.get(
  '/:id/videos',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('sort').optional().isIn(['latest', 'popular', 'oldest']),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const sort = req.query.sort as string || 'latest';
      const skip = (page - 1) * limit;

      // Build order by clause
      let orderBy: any;
      switch (sort) {
        case 'popular':
          orderBy = { views: 'desc' };
          break;
        case 'oldest':
          orderBy = { createdAt: 'asc' };
          break;
        default:
          orderBy = { createdAt: 'desc' };
      }

      const [videos, total] = await Promise.all([
        prisma.video.findMany({
          where: {
            channelId: id,
            status: 'PUBLISHED',
            privacy: 'PUBLIC',
          },
          select: {
            id: true,
            title: true,
            description: true,
            thumbnail: true,
            duration: true,
            views: true,
            likes: true,
            createdAt: true,
            _count: {
              select: {
                comments: true,
              },
            },
          },
          skip,
          take: limit,
          orderBy,
        }),
        prisma.video.count({
          where: {
            channelId: id,
            status: 'PUBLISHED',
            privacy: 'PUBLIC',
          },
        }),
      ]);

      res.json({
        videos,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('Get channel videos error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   GET /api/channels/:id/playlists
// @desc    Get channel playlists
// @access  Public
router.get('/:id/playlists', async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [playlists, total] = await Promise.all([
      prisma.playlist.findMany({
        where: {
          channelId: id,
          privacy: 'PUBLIC',
          status: 'ACTIVE',
        },
        include: {
          _count: {
            select: {
              items: true,
            },
          },
          items: {
            take: 1,
            include: {
              video: {
                select: {
                  thumbnail: true,
                },
              },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.playlist.count({
        where: {
          channelId: id,
          privacy: 'PUBLIC',
          status: 'ACTIVE',
        },
      }),
    ]);

    res.json({
      playlists,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('Get channel playlists error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

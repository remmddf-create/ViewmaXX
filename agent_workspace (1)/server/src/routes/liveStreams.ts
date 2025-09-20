import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import AWS from 'aws-sdk';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../services/database';
import { cache } from '../services/redis';
import logger from '../utils/logger';

const router = express.Router();

// Configure AWS S3
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION || 'us-east-1',
});

const s3 = new AWS.S3();

// Configure multer for thumbnail upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
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

// @route   GET /api/live/streams
// @desc    Get all live streams
// @access  Public
router.get(
  '/streams',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('status').optional().isIn(['LIVE', 'STARTING', 'ENDED', 'OFFLINE']),
    query('category').optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const status = req.query.status as string;
      const category = req.query.category as string;
      const skip = (page - 1) * limit;

      const where: any = {
        privacy: 'PUBLIC',
      };

      if (status) {
        where.status = status;
      } else {
        // Default to show only live and starting streams
        where.status = { in: ['LIVE', 'STARTING'] };
      }

      if (category) {
        where.category = category;
      }

      const [streams, total] = await Promise.all([
        prisma.liveStream.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatar: true,
                isVerified: true,
              },
            },
            channel: {
              select: {
                id: true,
                name: true,
                avatar: true,
                isVerified: true,
                _count: {
                  select: {
                    subscriptions: true,
                  },
                },
              },
            },
          },
          skip,
          take: limit,
          orderBy: [
            { status: 'asc' }, // LIVE first
            { viewers: 'desc' },
            { startedAt: 'desc' },
          ],
        }),
        prisma.liveStream.count({ where }),
      ]);

      res.json({
        streams,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('Get live streams error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   GET /api/live/streams/:id
// @desc    Get live stream by ID
// @access  Public
router.get('/streams/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const stream = await prisma.liveStream.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
            isVerified: true,
          },
        },
        channel: {
          include: {
            _count: {
              select: {
                subscriptions: true,
              },
            },
          },
        },
      },
    });

    if (!stream) {
      return res.status(404).json({ error: 'Live stream not found' });
    }

    // Check privacy
    if (stream.privacy === 'PRIVATE') {
      return res.status(403).json({ error: 'This stream is private' });
    }

    res.json(stream);
  } catch (error) {
    logger.error('Get live stream error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/live/streams
// @desc    Create live stream
// @access  Private
router.post(
  '/streams',
  authenticate,
  [
    body('title').isLength({ min: 1, max: 100 }).trim(),
    body('description').optional().isLength({ max: 1000 }).trim(),
    body('privacy').optional().isIn(['PUBLIC', 'UNLISTED', 'PRIVATE']),
    body('chatEnabled').optional().isBoolean(),
  ],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { title, description, privacy = 'PUBLIC', chatEnabled = true } = req.body;
      const userId = req.user!.id;

      // Check if user already has an active stream
      const existingStream = await prisma.liveStream.findFirst({
        where: {
          userId,
          status: { in: ['LIVE', 'STARTING'] },
        },
      });

      if (existingStream) {
        return res.status(400).json({ error: 'You already have an active stream' });
      }

      // Get user's channel
      const channel = await prisma.channel.findUnique({
        where: { userId },
      });

      if (!channel) {
        return res.status(400).json({ error: 'Channel not found' });
      }

      // Generate unique stream key
      const streamKey = `sk_${uuidv4().replace(/-/g, '')}`;

      const stream = await prisma.liveStream.create({
        data: {
          title,
          description,
          privacy,
          chatEnabled,
          streamKey,
          status: 'OFFLINE',
          userId,
          channelId: channel.id,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              avatar: true,
              isVerified: true,
            },
          },
          channel: {
            select: {
              id: true,
              name: true,
              avatar: true,
              isVerified: true,
            },
          },
        },
      });

      logger.info(`Live stream created: ${stream.id} by user ${userId}`);

      res.status(201).json({
        message: 'Live stream created successfully',
        stream,
        streamingInfo: {
          rtmpUrl: `${process.env.RTMP_SERVER_URL}/${streamKey}`,
          hlsUrl: `${process.env.HLS_SERVER_URL}/${streamKey}/playlist.m3u8`,
          streamKey, // Only show to creator
        },
      });
    } catch (error) {
      logger.error('Create live stream error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   PUT /api/live/streams/:id
// @desc    Update live stream
// @access  Private
router.put(
  '/streams/:id',
  authenticate,
  [
    body('title').optional().isLength({ min: 1, max: 100 }).trim(),
    body('description').optional().isLength({ max: 1000 }).trim(),
    body('privacy').optional().isIn(['PUBLIC', 'UNLISTED', 'PRIVATE']),
    body('chatEnabled').optional().isBoolean(),
  ],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { title, description, privacy, chatEnabled } = req.body;
      const userId = req.user!.id;

      // Check if user owns the stream
      const stream = await prisma.liveStream.findUnique({
        where: { id },
        select: { userId: true, status: true },
      });

      if (!stream || stream.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Can't update while live
      if (stream.status === 'LIVE') {
        return res.status(400).json({ error: 'Cannot update stream while live' });
      }

      const updatedStream = await prisma.liveStream.update({
        where: { id },
        data: {
          ...(title && { title }),
          ...(description !== undefined && { description }),
          ...(privacy && { privacy }),
          ...(chatEnabled !== undefined && { chatEnabled }),
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              avatar: true,
              isVerified: true,
            },
          },
          channel: {
            select: {
              id: true,
              name: true,
              avatar: true,
              isVerified: true,
            },
          },
        },
      });

      logger.info(`Live stream updated: ${id} by user ${userId}`);
      res.json({
        message: 'Live stream updated successfully',
        stream: updatedStream,
      });
    } catch (error) {
      logger.error('Update live stream error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   POST /api/live/streams/:id/start
// @desc    Start live stream
// @access  Private
router.post('/streams/:id/start', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Check if user owns the stream
    const stream = await prisma.liveStream.findUnique({
      where: { id },
      select: { userId: true, status: true },
    });

    if (!stream || stream.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (stream.status === 'LIVE') {
      return res.status(400).json({ error: 'Stream is already live' });
    }

    const updatedStream = await prisma.liveStream.update({
      where: { id },
      data: {
        status: 'STARTING',
        startedAt: new Date(),
      },
    });

    // Send notifications to subscribers
    const channel = await prisma.channel.findUnique({
      where: { userId },
      include: {
        subscriptions: {
          include: {
            user: {
              select: { id: true },
            },
          },
        },
      },
    });

    if (channel) {
      // Create notifications for subscribers
      const notifications = channel.subscriptions.map(sub => ({
        title: `${channel.name} is going live!`,
        message: `${updatedStream.title}`,
        type: 'VIDEO_UPLOAD' as const,
        userId: sub.user.id,
        data: {
          streamId: id,
          channelId: channel.id,
          channelName: channel.name,
        },
      }));

      await prisma.notification.createMany({
        data: notifications,
      });
    }

    logger.info(`Live stream started: ${id} by user ${userId}`);
    res.json({
      message: 'Live stream started successfully',
      stream: updatedStream,
    });
  } catch (error) {
    logger.error('Start live stream error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/live/streams/:id/stop
// @desc    Stop live stream
// @access  Private
router.post('/streams/:id/stop', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Check if user owns the stream
    const stream = await prisma.liveStream.findUnique({
      where: { id },
      select: { userId: true, status: true, viewers: true, maxViewers: true },
    });

    if (!stream || stream.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (stream.status === 'OFFLINE' || stream.status === 'ENDED') {
      return res.status(400).json({ error: 'Stream is not live' });
    }

    const updatedStream = await prisma.liveStream.update({
      where: { id },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
        viewers: 0,
      },
    });

    logger.info(`Live stream stopped: ${id} by user ${userId}`);
    res.json({
      message: 'Live stream stopped successfully',
      stream: updatedStream,
      stats: {
        maxViewers: stream.maxViewers,
        finalViewers: stream.viewers,
      },
    });
  } catch (error) {
    logger.error('Stop live stream error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/live/streams/:id/thumbnail
// @desc    Upload stream thumbnail
// @access  Private
router.post(
  '/streams/:id/thumbnail',
  authenticate,
  upload.single('thumbnail'),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      if (!req.file) {
        return res.status(400).json({ error: 'No thumbnail file uploaded' });
      }

      // Check if user owns the stream
      const stream = await prisma.liveStream.findUnique({
        where: { id },
        select: { userId: true },
      });

      if (!stream || stream.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const thumbnailUrl = await uploadToS3(req.file, 'stream-thumbnails');

      const updatedStream = await prisma.liveStream.update({
        where: { id },
        data: { thumbnail: thumbnailUrl },
        select: {
          id: true,
          title: true,
          thumbnail: true,
        },
      });

      logger.info(`Stream thumbnail updated: ${id}`);
      res.json({
        message: 'Thumbnail updated successfully',
        stream: updatedStream,
      });
    } catch (error) {
      logger.error('Upload stream thumbnail error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   GET /api/live/streams/:id/chat
// @desc    Get chat messages for a stream
// @access  Public
router.get('/streams/:id/chat', async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    // Check if stream exists and chat is enabled
    const stream = await prisma.liveStream.findUnique({
      where: { id },
      select: { chatEnabled: true, privacy: true },
    });

    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }

    if (!stream.chatEnabled) {
      return res.status(403).json({ error: 'Chat is disabled for this stream' });
    }

    if (stream.privacy === 'PRIVATE') {
      return res.status(403).json({ error: 'This stream is private' });
    }

    const [messages, total] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { liveStreamId: id },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              avatar: true,
              isVerified: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.chatMessage.count({ where: { liveStreamId: id } }),
    ]);

    res.json({
      messages: messages.reverse(), // Show oldest first
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('Get chat messages error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/live/streams/:id/join
// @desc    Join a live stream (increment viewer count)
// @access  Public
router.post('/streams/:id/join', async (req, res) => {
  try {
    const { id } = req.params;

    const stream = await prisma.liveStream.findUnique({
      where: { id },
      select: { status: true, privacy: true, viewers: true, maxViewers: true },
    });

    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }

    if (stream.privacy === 'PRIVATE') {
      return res.status(403).json({ error: 'This stream is private' });
    }

    if (stream.status !== 'LIVE') {
      return res.status(400).json({ error: 'Stream is not live' });
    }

    const newViewerCount = stream.viewers + 1;
    const newMaxViewers = Math.max(stream.maxViewers, newViewerCount);

    await prisma.liveStream.update({
      where: { id },
      data: {
        viewers: newViewerCount,
        maxViewers: newMaxViewers,
      },
    });

    res.json({
      message: 'Joined stream successfully',
      viewers: newViewerCount,
    });
  } catch (error) {
    logger.error('Join stream error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/live/streams/:id/leave
// @desc    Leave a live stream (decrement viewer count)
// @access  Public
router.post('/streams/:id/leave', async (req, res) => {
  try {
    const { id } = req.params;

    const stream = await prisma.liveStream.findUnique({
      where: { id },
      select: { viewers: true },
    });

    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }

    const newViewerCount = Math.max(0, stream.viewers - 1);

    await prisma.liveStream.update({
      where: { id },
      data: {
        viewers: newViewerCount,
      },
    });

    res.json({
      message: 'Left stream successfully',
      viewers: newViewerCount,
    });
  } catch (error) {
    logger.error('Leave stream error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   DELETE /api/live/streams/:id
// @desc    Delete live stream
// @access  Private
router.delete('/streams/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Check if user owns the stream
    const stream = await prisma.liveStream.findUnique({
      where: { id },
      select: { userId: true, status: true },
    });

    if (!stream || stream.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Can't delete while live
    if (stream.status === 'LIVE' || stream.status === 'STARTING') {
      return res.status(400).json({ error: 'Cannot delete stream while live' });
    }

    // Delete associated chat messages first
    await prisma.chatMessage.deleteMany({
      where: { liveStreamId: id },
    });

    // Delete the stream
    await prisma.liveStream.delete({
      where: { id },
    });

    logger.info(`Live stream deleted: ${id} by user ${userId}`);
    res.json({ message: 'Live stream deleted successfully' });
  } catch (error) {
    logger.error('Delete live stream error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

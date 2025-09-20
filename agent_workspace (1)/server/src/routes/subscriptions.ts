import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../services/database';
import { cache } from '../services/redis';
import logger from '../utils/logger';

const router = express.Router();

// @route   POST /api/subscriptions/subscribe
// @desc    Subscribe to a channel
// @access  Private
router.post(
  '/subscribe',
  authenticate,
  [body('channelId').isUUID()],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { channelId } = req.body;
      const userId = req.user!.id;

      // Check if channel exists
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        include: {
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      // Can't subscribe to your own channel
      if (channel.userId === userId) {
        return res.status(400).json({ error: 'Cannot subscribe to your own channel' });
      }

      // Check if already subscribed
      const existingSubscription = await prisma.subscription.findUnique({
        where: {
          userId_channelId: {
            userId,
            channelId,
          },
        },
      });

      if (existingSubscription) {
        return res.status(400).json({ error: 'Already subscribed to this channel' });
      }

      // Create subscription
      const subscription = await prisma.subscription.create({
        data: {
          userId,
          channelId,
        },
        include: {
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

      // Send notification to channel owner
      await prisma.notification.create({
        data: {
          title: 'New subscriber!',
          message: `${req.user!.username} subscribed to your channel`,
          type: 'SUBSCRIPTION',
          userId: channel.userId,
          data: {
            subscriberUsername: req.user!.username,
            subscriberId: userId,
            channelId,
          },
        },
      });

      // Clear related caches
      await cache.del(`channel:${channelId}`);
      await cache.del(`user:${userId}:subscriptions`);

      logger.info(`User ${userId} subscribed to channel ${channelId}`);
      res.status(201).json({
        message: 'Subscribed successfully',
        subscription,
      });
    } catch (error) {
      logger.error('Subscribe error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   POST /api/subscriptions/unsubscribe
// @desc    Unsubscribe from a channel
// @access  Private
router.post(
  '/unsubscribe',
  authenticate,
  [body('channelId').isUUID()],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { channelId } = req.body;
      const userId = req.user!.id;

      // Check if subscription exists
      const subscription = await prisma.subscription.findUnique({
        where: {
          userId_channelId: {
            userId,
            channelId,
          },
        },
      });

      if (!subscription) {
        return res.status(400).json({ error: 'Not subscribed to this channel' });
      }

      // Delete subscription
      await prisma.subscription.delete({
        where: {
          userId_channelId: {
            userId,
            channelId,
          },
        },
      });

      // Clear related caches
      await cache.del(`channel:${channelId}`);
      await cache.del(`user:${userId}:subscriptions`);

      logger.info(`User ${userId} unsubscribed from channel ${channelId}`);
      res.json({ message: 'Unsubscribed successfully' });
    } catch (error) {
      logger.error('Unsubscribe error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   GET /api/subscriptions
// @desc    Get user's subscriptions
// @access  Private
router.get(
  '/',
  authenticate,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      // Check cache first
      const cacheKey = `user:${userId}:subscriptions:${page}:${limit}`;
      const cachedSubscriptions = await cache.get(cacheKey);
      if (cachedSubscriptions) {
        return res.json(cachedSubscriptions);
      }

      const [subscriptions, total] = await Promise.all([
        prisma.subscription.findMany({
          where: { userId },
          include: {
            channel: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    avatar: true,
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
            },
          },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.subscription.count({ where: { userId } }),
      ]);

      const result = {
        subscriptions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };

      // Cache for 5 minutes
      await cache.set(cacheKey, result, 300);

      res.json(result);
    } catch (error) {
      logger.error('Get subscriptions error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   GET /api/subscriptions/feed
// @desc    Get subscription feed (videos from subscribed channels)
// @access  Private
router.get(
  '/feed',
  authenticate,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      // Check cache first
      const cacheKey = `user:${userId}:feed:${page}:${limit}`;
      const cachedFeed = await cache.get(cacheKey);
      if (cachedFeed) {
        return res.json(cachedFeed);
      }

      // Get user's subscribed channels
      const subscriptions = await prisma.subscription.findMany({
        where: { userId },
        select: { channelId: true },
      });

      const channelIds = subscriptions.map(sub => sub.channelId);

      if (channelIds.length === 0) {
        return res.json({
          videos: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0,
          },
        });
      }

      // Get videos from subscribed channels
      const [videos, total] = await Promise.all([
        prisma.video.findMany({
          where: {
            channelId: { in: channelIds },
            status: 'PUBLISHED',
            privacy: 'PUBLIC',
          },
          include: {
            channel: {
              select: {
                id: true,
                name: true,
                avatar: true,
                isVerified: true,
              },
            },
            user: {
              select: {
                id: true,
                username: true,
                avatar: true,
                isVerified: true,
              },
            },
            _count: {
              select: {
                comments: true,
                likes: true,
              },
            },
          },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.video.count({
          where: {
            channelId: { in: channelIds },
            status: 'PUBLISHED',
            privacy: 'PUBLIC',
          },
        }),
      ]);

      const result = {
        videos,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };

      // Cache for 2 minutes (feed changes frequently)
      await cache.set(cacheKey, result, 120);

      res.json(result);
    } catch (error) {
      logger.error('Get subscription feed error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   GET /api/subscriptions/check/:channelId
// @desc    Check if user is subscribed to a channel
// @access  Private
router.get('/check/:channelId', authenticate, async (req: AuthRequest, res) => {
  try {
    const { channelId } = req.params;
    const userId = req.user!.id;

    const subscription = await prisma.subscription.findUnique({
      where: {
        userId_channelId: {
          userId,
          channelId,
        },
      },
    });

    res.json({ isSubscribed: !!subscription });
  } catch (error) {
    logger.error('Check subscription error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   GET /api/subscriptions/subscribers/:channelId
// @desc    Get channel subscribers (admin/channel owner only)
// @access  Private
router.get(
  '/subscribers/:channelId',
  authenticate,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { channelId } = req.params;
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      // Check if user owns the channel or is admin
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { userId: true },
      });

      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      if (channel.userId !== userId && req.user!.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const [subscribers, total] = await Promise.all([
        prisma.subscription.findMany({
          where: { channelId },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatar: true,
                isVerified: true,
                createdAt: true,
              },
            },
          },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.subscription.count({ where: { channelId } }),
      ]);

      res.json({
        subscribers,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('Get subscribers error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

export default router;

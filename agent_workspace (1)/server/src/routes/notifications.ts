import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../services/database';
import { cache } from '../services/redis';
import logger from '../utils/logger';

const router = express.Router();

// @route   GET /api/notifications
// @desc    Get user notifications
// @access  Private
router.get(
  '/',
  authenticate,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('unread').optional().isBoolean(),
    query('type').optional().isIn(['VIDEO_UPLOAD', 'COMMENT', 'LIKE', 'SUBSCRIPTION', 'MONETIZATION', 'PAYMENT', 'SYSTEM']),
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
      const unread = req.query.unread === 'true';
      const type = req.query.type as string;
      const skip = (page - 1) * limit;

      const where: any = { userId };
      
      if (typeof unread === 'boolean') {
        where.isRead = !unread;
      }
      
      if (type) {
        where.type = type;
      }

      const [notifications, total, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({
          where: {
            userId,
            isRead: false,
          },
        }),
      ]);

      res.json({
        notifications,
        unreadCount,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('Get notifications error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   GET /api/notifications/unread-count
// @desc    Get unread notification count
// @access  Private
router.get('/unread-count', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    
    // Check cache first
    const cacheKey = `notifications:unread:${userId}`;
    const cachedCount = await cache.get(cacheKey);
    if (cachedCount !== null) {
      return res.json({ count: cachedCount });
    }

    const count = await prisma.notification.count({
      where: {
        userId,
        isRead: false,
      },
    });

    // Cache for 1 minute
    await cache.set(cacheKey, count, 60);

    res.json({ count });
  } catch (error) {
    logger.error('Get unread count error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   PUT /api/notifications/:id/read
// @desc    Mark notification as read
// @access  Private
router.put('/:id/read', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const notification = await prisma.notification.findUnique({
      where: { id },
      select: { userId: true, isRead: true },
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notification.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (notification.isRead) {
      return res.json({ message: 'Notification already read' });
    }

    await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    // Clear unread count cache
    await cache.del(`notifications:unread:${userId}`);

    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    logger.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   PUT /api/notifications/read-all
// @desc    Mark all notifications as read
// @access  Private
router.put('/read-all', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const result = await prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });

    // Clear unread count cache
    await cache.del(`notifications:unread:${userId}`);

    res.json({ 
      message: 'All notifications marked as read',
      count: result.count,
    });
  } catch (error) {
    logger.error('Mark all notifications read error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   DELETE /api/notifications/:id
// @desc    Delete notification
// @access  Private
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const notification = await prisma.notification.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notification.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await prisma.notification.delete({
      where: { id },
    });

    // Clear unread count cache
    await cache.del(`notifications:unread:${userId}`);

    res.json({ message: 'Notification deleted' });
  } catch (error) {
    logger.error('Delete notification error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   DELETE /api/notifications
// @desc    Delete all notifications
// @access  Private
router.delete('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const result = await prisma.notification.deleteMany({
      where: { userId },
    });

    // Clear unread count cache
    await cache.del(`notifications:unread:${userId}`);

    res.json({ 
      message: 'All notifications deleted',
      count: result.count,
    });
  } catch (error) {
    logger.error('Delete all notifications error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/notifications/test
// @desc    Send test notification (development only)
// @access  Private
router.post(
  '/test',
  authenticate,
  [
    body('title').isLength({ min: 1, max: 100 }).trim(),
    body('message').isLength({ min: 1, max: 500 }).trim(),
    body('type').isIn(['VIDEO_UPLOAD', 'COMMENT', 'LIKE', 'SUBSCRIPTION', 'MONETIZATION', 'PAYMENT', 'SYSTEM']),
  ],
  async (req: AuthRequest, res) => {
    try {
      // Only allow in development
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Not available in production' });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { title, message, type } = req.body;
      const userId = req.user!.id;

      const notification = await prisma.notification.create({
        data: {
          title,
          message,
          type,
          userId,
          data: {
            test: true,
            timestamp: new Date(),
          },
        },
      });

      // Clear unread count cache
      await cache.del(`notifications:unread:${userId}`);

      res.status(201).json({
        message: 'Test notification sent',
        notification,
      });
    } catch (error) {
      logger.error('Send test notification error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// Helper function to create notification (for internal use)
export const createNotification = async (data: {
  title: string;
  message: string;
  type: 'VIDEO_UPLOAD' | 'COMMENT' | 'LIKE' | 'SUBSCRIPTION' | 'MONETIZATION' | 'PAYMENT' | 'SYSTEM';
  userId: string;
  data?: any;
}) => {
  try {
    const notification = await prisma.notification.create({
      data,
    });

    // Clear unread count cache
    await cache.del(`notifications:unread:${data.userId}`);

    return notification;
  } catch (error) {
    logger.error('Create notification error:', error);
    throw error;
  }
};

export default router;

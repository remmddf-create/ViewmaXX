import express from 'express';
import { body, validationResult, query } from 'express-validator';
import Stripe from 'stripe';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../services/database';
import { cache } from '../services/redis';
import logger from '../utils/logger';
import moment from 'moment';

const router = express.Router();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

const MIN_SUBSCRIBERS = parseInt(process.env.MIN_SUBSCRIBERS_FOR_MONETIZATION || '100');
const MIN_VIEWS = parseInt(process.env.MIN_VIEWS_FOR_MONETIZATION || '50000');
const MIN_WATCH_TIME_MINUTES = parseInt(process.env.MIN_WATCH_TIME_MINUTES || '3');
const REVENUE_SHARE_PERCENTAGE = parseFloat(process.env.REVENUE_SHARE_PERCENTAGE || '70');

// @route   POST /api/monetization/apply
// @desc    Apply for monetization
// @access  Private
router.post('/apply', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    // Check if user already has monetization
    const existingMonetization = await prisma.monetization.findUnique({
      where: { userId },
    });

    if (existingMonetization) {
      return res.status(400).json({ 
        error: 'Monetization application already exists',
        status: existingMonetization.status,
      });
    }

    // Check eligibility
    const eligibility = await checkMonetizationEligibility(userId);
    
    if (!eligibility.eligible) {
      return res.status(400).json({
        error: 'Not eligible for monetization',
        requirements: eligibility.requirements,
      });
    }

    // Create monetization application
    const monetization = await prisma.monetization.create({
      data: {
        userId,
        status: 'PENDING',
        revenueShare: REVENUE_SHARE_PERCENTAGE,
      },
    });

    // Send notification to user
    await prisma.notification.create({
      data: {
        title: 'Monetization Application Submitted',
        message: 'Your monetization application has been submitted and is under review.',
        type: 'MONETIZATION',
        userId,
        data: {
          monetizationId: monetization.id,
          status: 'PENDING',
        },
      },
    });

    logger.info(`Monetization application submitted by user ${userId}`);
    res.status(201).json({
      message: 'Monetization application submitted successfully',
      monetization,
    });
  } catch (error) {
    logger.error('Apply monetization error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   GET /api/monetization/status
// @desc    Get monetization status
// @access  Private
router.get('/status', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const monetization = await prisma.monetization.findUnique({
      where: { userId },
    });

    if (!monetization) {
      // Check eligibility
      const eligibility = await checkMonetizationEligibility(userId);
      
      return res.json({
        hasMonetization: false,
        eligible: eligibility.eligible,
        requirements: eligibility.requirements,
      });
    }

    res.json({
      hasMonetization: true,
      monetization,
    });
  } catch (error) {
    logger.error('Get monetization status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   GET /api/monetization/analytics
// @desc    Get monetization analytics
// @access  Private
router.get(
  '/analytics',
  authenticate,
  [
    query('period').optional().isIn(['7d', '30d', '90d', '1y']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const period = req.query.period as string || '30d';
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;

      // Check if user has approved monetization
      const monetization = await prisma.monetization.findUnique({
        where: { userId },
      });

      if (!monetization || monetization.status !== 'APPROVED') {
        return res.status(403).json({ error: 'Monetization not approved' });
      }

      // Calculate date range
      let dateFilter: { gte: Date; lte?: Date };
      
      if (startDate && endDate) {
        dateFilter = {
          gte: new Date(startDate),
          lte: new Date(endDate),
        };
      } else {
        const now = new Date();
        let daysBack: number;
        
        switch (period) {
          case '7d':
            daysBack = 7;
            break;
          case '90d':
            daysBack = 90;
            break;
          case '1y':
            daysBack = 365;
            break;
          default:
            daysBack = 30;
        }
        
        dateFilter = {
          gte: new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000),
        };
      }

      // Get analytics data
      const [userAnalytics, videoAnalytics, totalStats] = await Promise.all([
        prisma.userAnalytics.findMany({
          where: {
            userId,
            date: dateFilter,
          },
          orderBy: { date: 'asc' },
        }),
        prisma.videoAnalytics.findMany({
          where: {
            video: {
              userId,
            },
            date: dateFilter,
          },
          include: {
            video: {
              select: {
                id: true,
                title: true,
                thumbnail: true,
              },
            },
          },
          orderBy: { revenue: 'desc' },
          take: 10, // Top 10 earning videos
        }),
        // Get total stats
        prisma.userAnalytics.aggregate({
          where: {
            userId,
            date: dateFilter,
          },
          _sum: {
            totalViews: true,
            watchTime: true,
            revenue: true,
          },
        }),
      ]);

      res.json({
        monetization,
        analytics: {
          daily: userAnalytics,
          topVideos: videoAnalytics,
          totals: {
            views: totalStats._sum.totalViews || 0,
            watchTimeMinutes: totalStats._sum.watchTime || 0,
            revenue: totalStats._sum.revenue || 0,
          },
        },
      });
    } catch (error) {
      logger.error('Get monetization analytics error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   POST /api/monetization/payout
// @desc    Request payout
// @access  Private
router.post(
  '/payout',
  authenticate,
  [
    body('amount').isFloat({ min: 10 }), // Minimum $10 payout
    body('method').isIn(['STRIPE', 'PAYPAL']),
  ],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { amount, method } = req.body;
      const userId = req.user!.id;

      // Check monetization status
      const monetization = await prisma.monetization.findUnique({
        where: { userId },
      });

      if (!monetization || monetization.status !== 'APPROVED') {
        return res.status(403).json({ error: 'Monetization not approved' });
      }

      if (monetization.availableBalance < amount) {
        return res.status(400).json({ 
          error: 'Insufficient balance',
          availableBalance: monetization.availableBalance,
        });
      }

      // Create payment record
      const payment = await prisma.payment.create({
        data: {
          userId,
          amount,
          method,
          status: 'PENDING',
          currency: 'USD',
        },
      });

      // Process payment based on method
      if (method === 'STRIPE') {
        // In a real implementation, you would:
        // 1. Create Stripe transfer
        // 2. Update payment with Stripe ID
        // For now, we'll mark as completed
        await prisma.payment.update({
          where: { id: payment.id },
          data: { 
            status: 'COMPLETED',
            stripeId: `transfer_${Date.now()}`, // Mock Stripe ID
          },
        });
      }

      // Update available balance
      await prisma.monetization.update({
        where: { userId },
        data: {
          availableBalance: {
            decrement: amount,
          },
        },
      });

      // Send notification
      await prisma.notification.create({
        data: {
          title: 'Payout Processed',
          message: `Your payout of $${amount} has been processed and will arrive in 3-5 business days.`,
          type: 'PAYMENT',
          userId,
          data: {
            paymentId: payment.id,
            amount,
            method,
          },
        },
      });

      logger.info(`Payout requested: $${amount} for user ${userId}`);
      res.status(201).json({
        message: 'Payout requested successfully',
        payment,
      });
    } catch (error) {
      logger.error('Request payout error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   GET /api/monetization/payments
// @desc    Get payment history
// @access  Private
router.get(
  '/payments',
  authenticate,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('status').optional().isIn(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED']),
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
      const status = req.query.status as string;
      const skip = (page - 1) * limit;

      const where: any = { userId };
      if (status) {
        where.status = status;
      }

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.payment.count({ where }),
      ]);

      res.json({
        payments,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('Get payments error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// Helper function to check monetization eligibility
const checkMonetizationEligibility = async (userId: string) => {
  const thirtyDaysAgo = moment().subtract(30, 'days').toDate();
  
  // Get user data
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      channel: {
        include: {
          subscriptions: true,
        },
      },
      videos: {
        include: {
          watchHistory: {
            where: {
              createdAt: {
                gte: thirtyDaysAgo,
              },
              watchTime: {
                gte: MIN_WATCH_TIME_MINUTES * 60, // Convert to seconds
              },
            },
          },
        },
      },
    },
  });

  if (!user) {
    return {
      eligible: false,
      requirements: {
        subscribers: { required: MIN_SUBSCRIBERS, current: 0 },
        views: { required: MIN_VIEWS, current: 0 },
        watchTime: { required: MIN_WATCH_TIME_MINUTES, current: 0 },
      },
    };
  }

  const subscriberCount = user.channel?.subscriptions.length || 0;
  const totalViews = user.videos.reduce((sum, video) => sum + video.watchHistory.length, 0);
  const totalWatchTimeMinutes = user.videos.reduce(
    (sum, video) => sum + video.watchHistory.reduce(
      (watchSum, history) => watchSum + history.watchTime, 0
    ), 0
  ) / 60; // Convert to minutes

  const requirements = {
    subscribers: {
      required: MIN_SUBSCRIBERS,
      current: subscriberCount,
      met: subscriberCount >= MIN_SUBSCRIBERS,
    },
    views: {
      required: MIN_VIEWS,
      current: totalViews,
      met: totalViews >= MIN_VIEWS,
    },
    watchTime: {
      required: MIN_WATCH_TIME_MINUTES,
      current: Math.floor(totalWatchTimeMinutes),
      met: totalWatchTimeMinutes >= MIN_WATCH_TIME_MINUTES,
    },
  };

  const eligible = requirements.subscribers.met && requirements.views.met && requirements.watchTime.met;

  return { eligible, requirements };
};

export default router;

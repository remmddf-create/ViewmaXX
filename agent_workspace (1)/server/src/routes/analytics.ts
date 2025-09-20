import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../services/database';
import { cache } from '../services/redis';
import logger from '../utils/logger';
import moment from 'moment';

const router = express.Router();

// @route   GET /api/analytics/overview
// @desc    Get analytics overview for user's channel
// @access  Private
router.get(
  '/overview',
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

      // Check cache
      const cacheKey = `analytics:overview:${userId}:${period}:${startDate || 'none'}:${endDate || 'none'}`;
      const cachedData = await cache.get(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }

      const [userAnalytics, channelAnalytics, totalStats, recentVideos] = await Promise.all([
        // User analytics
        prisma.userAnalytics.findMany({
          where: {
            userId,
            date: dateFilter,
          },
          orderBy: { date: 'asc' },
        }),
        // Channel analytics
        prisma.channelAnalytics.findMany({
          where: {
            channel: {
              userId,
            },
            date: dateFilter,
          },
          orderBy: { date: 'asc' },
        }),
        // Total aggregated stats
        prisma.userAnalytics.aggregate({
          where: {
            userId,
            date: dateFilter,
          },
          _sum: {
            totalViews: true,
            watchTime: true,
            newSubscribers: true,
            revenue: true,
          },
        }),
        // Recent videos performance
        prisma.video.findMany({
          where: {
            userId,
            status: 'PUBLISHED',
            createdAt: dateFilter,
          },
          select: {
            id: true,
            title: true,
            thumbnail: true,
            views: true,
            likes: true,
            createdAt: true,
            _count: {
              select: {
                comments: true,
              },
            },
          },
          orderBy: { views: 'desc' },
          take: 10,
        }),
      ]);

      const overview = {
        period,
        dateRange: {
          start: dateFilter.gte,
          end: dateFilter.lte || new Date(),
        },
        totals: {
          views: totalStats._sum.totalViews || 0,
          watchTimeMinutes: totalStats._sum.watchTime || 0,
          subscribers: totalStats._sum.newSubscribers || 0,
          revenue: totalStats._sum.revenue || 0,
        },
        daily: {
          user: userAnalytics,
          channel: channelAnalytics,
        },
        topVideos: recentVideos,
      };

      // Cache for 10 minutes
      await cache.set(cacheKey, overview, 600);

      res.json(overview);
    } catch (error) {
      logger.error('Get analytics overview error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   GET /api/analytics/videos/:videoId
// @desc    Get detailed analytics for a specific video
// @access  Private
router.get('/videos/:videoId', authenticate, async (req: AuthRequest, res) => {
  try {
    const { videoId } = req.params;
    const userId = req.user!.id;
    const period = req.query.period as string || '30d';

    // Check if user owns the video
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { userId: true, title: true, createdAt: true },
    });

    if (!video || video.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Calculate date range
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
    
    const dateFilter = {
      gte: new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000),
    };

    const [videoAnalytics, watchHistory, comments, likes] = await Promise.all([
      // Daily video analytics
      prisma.videoAnalytics.findMany({
        where: {
          videoId,
          date: dateFilter,
        },
        orderBy: { date: 'asc' },
      }),
      // Watch history patterns
      prisma.watchHistory.findMany({
        where: {
          videoId,
          createdAt: dateFilter,
        },
        select: {
          watchTime: true,
          completed: true,
          createdAt: true,
        },
      }),
      // Recent comments
      prisma.comment.findMany({
        where: {
          videoId,
          createdAt: dateFilter,
        },
        include: {
          user: {
            select: {
              username: true,
              avatar: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      // Like/dislike data
      prisma.like.groupBy({
        by: ['type'],
        where: {
          videoId,
          createdAt: dateFilter,
        },
        _count: {
          type: true,
        },
      }),
    ]);

    // Calculate engagement metrics
    const totalViews = watchHistory.length;
    const completionRate = totalViews > 0 ? 
      (watchHistory.filter(w => w.completed).length / totalViews) * 100 : 0;
    const averageWatchTime = totalViews > 0 ?
      watchHistory.reduce((sum, w) => sum + w.watchTime, 0) / totalViews : 0;

    const likesCount = likes.find(l => l.type === 'LIKE')?._count.type || 0;
    const dislikesCount = likes.find(l => l.type === 'DISLIKE')?._count.type || 0;
    const engagementRate = totalViews > 0 ?
      ((likesCount + dislikesCount + comments.length) / totalViews) * 100 : 0;

    const analytics = {
      video: {
        id: videoId,
        title: video.title,
        publishedAt: video.createdAt,
      },
      period,
      metrics: {
        views: totalViews,
        likes: likesCount,
        dislikes: dislikesCount,
        comments: comments.length,
        completionRate,
        averageWatchTime,
        engagementRate,
      },
      daily: videoAnalytics,
      recentComments: comments,
      watchTimeDistribution: {
        // Group watch times into buckets
        '0-25%': watchHistory.filter(w => w.watchTime < video.duration * 0.25).length,
        '25-50%': watchHistory.filter(w => w.watchTime >= video.duration * 0.25 && w.watchTime < video.duration * 0.5).length,
        '50-75%': watchHistory.filter(w => w.watchTime >= video.duration * 0.5 && w.watchTime < video.duration * 0.75).length,
        '75-100%': watchHistory.filter(w => w.watchTime >= video.duration * 0.75).length,
      },
    };

    res.json(analytics);
  } catch (error) {
    logger.error('Get video analytics error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   GET /api/analytics/audience
// @desc    Get audience demographics and behavior
// @access  Private
router.get('/audience', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const period = req.query.period as string || '30d';

    // Calculate date range
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
    
    const dateFilter = {
      gte: new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000),
    };

    const [subscribers, watchHistory, comments] = await Promise.all([
      // Subscriber growth
      prisma.subscription.findMany({
        where: {
          channel: {
            userId,
          },
          createdAt: dateFilter,
        },
        include: {
          user: {
            select: {
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      // Watch patterns
      prisma.watchHistory.findMany({
        where: {
          video: {
            userId,
          },
          createdAt: dateFilter,
        },
        select: {
          createdAt: true,
          watchTime: true,
          user: {
            select: {
              createdAt: true,
            },
          },
        },
      }),
      // Comment activity
      prisma.comment.findMany({
        where: {
          video: {
            userId,
          },
          createdAt: dateFilter,
        },
        select: {
          createdAt: true,
          user: {
            select: {
              createdAt: true,
            },
          },
        },
      }),
    ]);

    // Analyze subscriber demographics
    const newSubscribers = subscribers.length;
    const returningViewers = watchHistory.filter(w => 
      moment(w.user.createdAt).isBefore(dateFilter.gte)
    ).length;
    const newViewers = watchHistory.length - returningViewers;

    // Watch time patterns by hour
    const hourlyViews = Array(24).fill(0);
    watchHistory.forEach(w => {
      const hour = moment(w.createdAt).hour();
      hourlyViews[hour]++;
    });

    // Engagement by user age (account age)
    const userAgeGroups = {
      'new': 0, // < 1 month
      'regular': 0, // 1-6 months
      'veteran': 0, // > 6 months
    };

    watchHistory.forEach(w => {
      const accountAge = moment().diff(moment(w.user.createdAt), 'months');
      if (accountAge < 1) userAgeGroups.new++;
      else if (accountAge < 6) userAgeGroups.regular++;
      else userAgeGroups.veteran++;
    });

    const audience = {
      period,
      growth: {
        newSubscribers,
        totalViews: watchHistory.length,
        newViewers,
        returningViewers,
      },
      demographics: {
        userAgeGroups,
      },
      behavior: {
        hourlyViews,
        averageWatchTime: watchHistory.length > 0 ?
          watchHistory.reduce((sum, w) => sum + w.watchTime, 0) / watchHistory.length : 0,
        engagementRate: watchHistory.length > 0 ?
          (comments.length / watchHistory.length) * 100 : 0,
      },
      subscriberGrowth: subscribers.map(sub => ({
        date: sub.createdAt,
        count: 1,
      })),
    };

    res.json(audience);
  } catch (error) {
    logger.error('Get audience analytics error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   GET /api/analytics/revenue
// @desc    Get revenue analytics
// @access  Private
router.get('/revenue', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const period = req.query.period as string || '30d';

    // Check if user has monetization enabled
    const monetization = await prisma.monetization.findUnique({
      where: { userId },
    });

    if (!monetization || monetization.status !== 'APPROVED') {
      return res.status(403).json({ error: 'Monetization not enabled' });
    }

    // Calculate date range
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
    
    const dateFilter = {
      gte: new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000),
    };

    const [userAnalytics, videoAnalytics, payments] = await Promise.all([
      // Daily revenue
      prisma.userAnalytics.findMany({
        where: {
          userId,
          date: dateFilter,
        },
        select: {
          date: true,
          revenue: true,
          totalViews: true,
        },
        orderBy: { date: 'asc' },
      }),
      // Video revenue breakdown
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
        take: 10,
      }),
      // Payment history
      prisma.payment.findMany({
        where: {
          userId,
          createdAt: dateFilter,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalRevenue = userAnalytics.reduce((sum, day) => sum + day.revenue, 0);
    const totalViews = userAnalytics.reduce((sum, day) => sum + day.totalViews, 0);
    const rpm = totalViews > 0 ? (totalRevenue / totalViews) * 1000 : 0; // Revenue per mille

    const revenue = {
      period,
      monetization: {
        status: monetization.status,
        revenueShare: monetization.revenueShare,
        totalEarnings: monetization.totalEarnings,
        availableBalance: monetization.availableBalance,
        lifetimeEarnings: monetization.lifetimeEarnings,
      },
      metrics: {
        totalRevenue,
        totalViews,
        rpm,
        averageDailyRevenue: userAnalytics.length > 0 ? totalRevenue / userAnalytics.length : 0,
      },
      daily: userAnalytics,
      topEarningVideos: videoAnalytics,
      recentPayouts: payments,
    };

    res.json(revenue);
  } catch (error) {
    logger.error('Get revenue analytics error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/analytics/track-view
// @desc    Track video view for analytics
// @access  Private
router.post(
  '/track-view',
  authenticate,
  [
    body('videoId').isUUID(),
    body('watchTime').isInt({ min: 0 }),
    body('completed').isBoolean(),
  ],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { videoId, watchTime, completed } = req.body;
      const userId = req.user!.id;

      // Update or create watch history
      await prisma.watchHistory.upsert({
        where: {
          userId_videoId: {
            userId,
            videoId,
          },
        },
        update: {
          watchTime: Math.max(watchTime, 0), // Take the maximum watch time
          completed,
          lastPosition: watchTime,
        },
        create: {
          userId,
          videoId,
          watchTime,
          completed,
          lastPosition: watchTime,
        },
      });

      res.json({ message: 'View tracked successfully' });
    } catch (error) {
      logger.error('Track view error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

export default router;

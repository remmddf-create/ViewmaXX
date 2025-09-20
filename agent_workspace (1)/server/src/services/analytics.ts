import { PrismaClient } from '@prisma/client';
import { redis } from './redis';

const prisma = new PrismaClient();

// Track video view
export const trackVideoView = async (
  videoId: string,
  viewerIP: string,
  watchTime?: number,
  userId?: string
): Promise<void> => {
  try {
    // Create view record
    await prisma.videoView.create({
      data: {
        videoId,
        viewerIP,
        watchTime: watchTime || 0,
        userId,
        viewedAt: new Date(),
      },
    });

    // Update video view count
    await prisma.video.update({
      where: { id: videoId },
      data: {
        views: { increment: 1 },
      },
    });

    // Track daily views in Redis
    const today = new Date().toISOString().split('T')[0];
    await redis.hincrby(`daily_views:${today}`, videoId, 1);
    await redis.hincrby(`daily_views:${today}`, 'total', 1);
    await redis.expire(`daily_views:${today}`, 30 * 24 * 60 * 60); // 30 days

    // Track hourly views for trending calculation
    const hour = new Date().toISOString().substring(0, 13);
    await redis.hincrby(`hourly_views:${hour}`, videoId, 1);
    await redis.expire(`hourly_views:${hour}`, 24 * 60 * 60); // 24 hours

  } catch (error) {
    console.error('Track video view error:', error);
  }
};

// Get video analytics
export const getVideoAnalytics = async (
  videoId: string,
  startDate: Date,
  endDate: Date
): Promise<any> => {
  try {
    const [views, likes, comments, watchTime] = await Promise.all([
      // Views analytics
      prisma.videoView.groupBy({
        by: ['viewedAt'],
        where: {
          videoId,
          viewedAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        _count: {
          id: true,
        },
        _sum: {
          watchTime: true,
        },
        orderBy: {
          viewedAt: 'asc',
        },
      }),

      // Likes analytics
      prisma.videoLike.groupBy({
        by: ['createdAt', 'isLike'],
        where: {
          videoId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        _count: {
          id: true,
        },
      }),

      // Comments analytics
      prisma.comment.groupBy({
        by: ['createdAt'],
        where: {
          videoId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        _count: {
          id: true,
        },
      }),

      // Watch time analytics
      prisma.videoView.aggregate({
        where: {
          videoId,
          viewedAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        _sum: {
          watchTime: true,
        },
        _avg: {
          watchTime: true,
        },
      }),
    ]);

    return {
      views: {
        total: views.reduce((sum, item) => sum + item._count.id, 0),
        daily: views,
      },
      engagement: {
        likes: likes.filter(item => item.isLike).reduce((sum, item) => sum + item._count.id, 0),
        dislikes: likes.filter(item => !item.isLike).reduce((sum, item) => sum + item._count.id, 0),
        comments: comments.reduce((sum, item) => sum + item._count.id, 0),
      },
      watchTime: {
        total: watchTime._sum.watchTime || 0,
        average: watchTime._avg.watchTime || 0,
      },
    };
  } catch (error) {
    console.error('Get video analytics error:', error);
    throw error;
  }
};

// Get channel analytics
export const getChannelAnalytics = async (
  channelId: string,
  startDate: Date,
  endDate: Date
): Promise<any> => {
  try {
    const [subscribers, videoStats, revenue] = await Promise.all([
      // Subscriber growth
      prisma.subscription.groupBy({
        by: ['createdAt'],
        where: {
          channelId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        _count: {
          id: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      }),

      // Video performance
      prisma.video.findMany({
        where: {
          channelId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        select: {
          id: true,
          title: true,
          views: true,
          likes: true,
          dislikes: true,
          createdAt: true,
          _count: {
            select: {
              comments: true,
            },
          },
        },
      }),

      // Revenue (if monetized)
      prisma.revenue.aggregate({
        where: {
          channelId,
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    const totalViews = videoStats.reduce((sum, video) => sum + video.views, 0);
    const totalLikes = videoStats.reduce((sum, video) => sum + video.likes, 0);
    const totalComments = videoStats.reduce((sum, video) => sum + video._count.comments, 0);

    return {
      subscribers: {
        growth: subscribers,
        total: subscribers.reduce((sum, item) => sum + item._count.id, 0),
      },
      videos: {
        count: videoStats.length,
        totalViews,
        totalLikes,
        totalComments,
        topPerforming: videoStats
          .sort((a, b) => b.views - a.views)
          .slice(0, 10),
      },
      revenue: {
        total: revenue._sum.amount || 0,
      },
    };
  } catch (error) {
    console.error('Get channel analytics error:', error);
    throw error;
  }
};

// Get trending videos
export const getTrendingVideos = async (limit: number = 50): Promise<any[]> => {
  try {
    // Get videos with high recent engagement
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const trendingVideos = await prisma.video.findMany({
      where: {
        status: 'published',
        visibility: 'public',
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        },
      },
      include: {
        channel: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
            isVerified: true,
          },
        },
        _count: {
          select: {
            views: {
              where: {
                viewedAt: {
                  gte: last24Hours,
                },
              },
            },
            likes: {
              where: {
                createdAt: {
                  gte: last24Hours,
                },
              },
            },
            comments: {
              where: {
                createdAt: {
                  gte: last24Hours,
                },
              },
            },
          },
        },
      },
      take: limit * 2, // Get more to calculate trending score
    });

    // Calculate trending score
    const scoredVideos = trendingVideos.map(video => {
      const recentViews = video._count.views;
      const recentLikes = video._count.likes;
      const recentComments = video._count.comments;
      const ageHours = (Date.now() - video.createdAt.getTime()) / (1000 * 60 * 60);
      
      // Trending score formula (can be adjusted)
      const trendingScore = (
        (recentViews * 1) +
        (recentLikes * 5) +
        (recentComments * 10)
      ) / Math.max(ageHours, 1);
      
      return {
        ...video,
        trendingScore,
      };
    });

    // Sort by trending score and return top videos
    return scoredVideos
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, limit);
  } catch (error) {
    console.error('Get trending videos error:', error);
    throw error;
  }
};

// Track user engagement
export const trackUserEngagement = async (
  userId: string,
  action: 'like' | 'comment' | 'share' | 'subscribe',
  targetId: string,
  targetType: 'video' | 'channel'
): Promise<void> => {
  try {
    await prisma.userEngagement.create({
      data: {
        userId,
        action,
        targetId,
        targetType,
        timestamp: new Date(),
      },
    });

    // Track in Redis for real-time analytics
    const today = new Date().toISOString().split('T')[0];
    await redis.hincrby(`engagement:${today}`, `${action}:${targetType}`, 1);
    await redis.expire(`engagement:${today}`, 30 * 24 * 60 * 60); // 30 days
  } catch (error) {
    console.error('Track user engagement error:', error);
  }
};

// Get platform analytics (admin)
export const getPlatformAnalytics = async (
  startDate: Date,
  endDate: Date
): Promise<any> => {
  try {
    const [users, videos, views, revenue] = await Promise.all([
      // User registration analytics
      prisma.user.groupBy({
        by: ['createdAt'],
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        _count: {
          id: true,
        },
      }),

      // Video upload analytics
      prisma.video.groupBy({
        by: ['createdAt'],
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        _count: {
          id: true,
        },
      }),

      // Total views
      prisma.videoView.count({
        where: {
          viewedAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      }),

      // Platform revenue
      prisma.revenue.aggregate({
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
        _sum: {
          amount: true,
          platformFee: true,
        },
      }),
    ]);

    return {
      users: {
        registrations: users,
        total: users.reduce((sum, item) => sum + item._count.id, 0),
      },
      videos: {
        uploads: videos,
        total: videos.reduce((sum, item) => sum + item._count.id, 0),
      },
      views: {
        total: views,
      },
      revenue: {
        total: revenue._sum.amount || 0,
        platformFees: revenue._sum.platformFee || 0,
      },
    };
  } catch (error) {
    console.error('Get platform analytics error:', error);
    throw error;
  }
};

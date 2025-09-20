import express from 'express';
import { query, validationResult } from 'express-validator';
import { optionalAuth, AuthRequest } from '../middleware/auth';
import { search } from '../services/elasticsearch';
import { cache } from '../services/redis';
import logger from '../utils/logger';

const router = express.Router();

// @route   GET /api/search
// @desc    Global search (videos, channels, users)
// @access  Public
router.get(
  '/',
  optionalAuth,
  [
    query('q').isLength({ min: 1, max: 100 }).trim(),
    query('type').optional().isIn(['all', 'videos', 'channels', 'users']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('sort').optional().isIn(['relevance', 'date', 'views', 'rating']),
    query('duration').optional().isIn(['short', 'medium', 'long']),
    query('uploadDate').optional().isIn(['hour', 'today', 'week', 'month', 'year']),
    query('category').optional().trim(),
  ],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const query = req.query.q as string;
      const type = req.query.type as string || 'all';
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const sort = req.query.sort as string || 'relevance';
      const duration = req.query.duration as string;
      const uploadDate = req.query.uploadDate as string;
      const category = req.query.category as string;
      const offset = (page - 1) * limit;

      // Check cache first
      const cacheKey = `search:${query}:${type}:${page}:${limit}:${sort}:${duration || 'all'}:${uploadDate || 'all'}:${category || 'all'}`;
      const cachedResults = await cache.get(cacheKey);
      if (cachedResults) {
        return res.json(cachedResults);
      }

      let results: any = {
        query,
        type,
        videos: { items: [], total: 0 },
        channels: { items: [], total: 0 },
        users: { items: [], total: 0 },
      };

      // Search videos
      if (type === 'all' || type === 'videos') {
        const filters: any = {};
        
        if (category) filters.category = category;
        if (duration) {
          switch (duration) {
            case 'short':
              filters.duration = { min: 0, max: 240 }; // 4 minutes
              break;
            case 'medium':
              filters.duration = { min: 240, max: 1200 }; // 4-20 minutes
              break;
            case 'long':
              filters.duration = { min: 1200, max: 999999 }; // 20+ minutes
              break;
          }
        }
        if (uploadDate) {
          const now = new Date();
          let dateFilter: string;
          
          switch (uploadDate) {
            case 'hour':
              dateFilter = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
              break;
            case 'today':
              dateFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
              break;
            case 'week':
              dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
              break;
            case 'month':
              dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
              break;
            case 'year':
              dateFilter = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
              break;
            default:
              dateFilter = new Date(0).toISOString();
          }
          
          filters.uploadDate = dateFilter;
        }

        const videoResults = await search.videos(query, filters, limit, offset);
        results.videos = {
          items: videoResults.videos,
          total: videoResults.total,
        };
      }

      // Search channels
      if (type === 'all' || type === 'channels') {
        const channelResults = await search.channels(query, limit, offset);
        results.channels = {
          items: channelResults.channels,
          total: channelResults.total,
        };
      }

      // Search users (fallback to database for now)
      if (type === 'all' || type === 'users') {
        // Since Elasticsearch doesn't have users index in this implementation,
        // we'll search the database directly
        try {
          const { prisma } = await import('../services/database');
          
          const [users, userTotal] = await Promise.all([
            prisma.user.findMany({
              where: {
                OR: [
                  { username: { contains: query, mode: 'insensitive' } },
                  { firstName: { contains: query, mode: 'insensitive' } },
                  { lastName: { contains: query, mode: 'insensitive' } },
                ],
                isActive: true,
              },
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                avatar: true,
                isVerified: true,
                createdAt: true,
                channel: {
                  select: {
                    id: true,
                    name: true,
                    _count: {
                      select: {
                        subscriptions: true,
                        videos: true,
                      },
                    },
                  },
                },
              },
              skip: offset,
              take: limit,
              orderBy: {
                createdAt: 'desc',
              },
            }),
            prisma.user.count({
              where: {
                OR: [
                  { username: { contains: query, mode: 'insensitive' } },
                  { firstName: { contains: query, mode: 'insensitive' } },
                  { lastName: { contains: query, mode: 'insensitive' } },
                ],
                isActive: true,
              },
            }),
          ]);

          results.users = {
            items: users,
            total: userTotal,
          };
        } catch (error) {
          logger.error('User search error:', error);
          results.users = { items: [], total: 0 };
        }
      }

      // Add pagination info
      results.pagination = {
        page,
        limit,
        hasMore: {
          videos: results.videos.total > offset + results.videos.items.length,
          channels: results.channels.total > offset + results.channels.items.length,
          users: results.users.total > offset + results.users.items.length,
        },
      };

      // Cache results for 5 minutes
      await cache.set(cacheKey, results, 300);

      res.json(results);
    } catch (error) {
      logger.error('Search error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   GET /api/search/suggestions
// @desc    Get search suggestions
// @access  Public
router.get(
  '/suggestions',
  [
    query('q').isLength({ min: 1, max: 50 }).trim(),
    query('limit').optional().isInt({ min: 1, max: 10 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 5;

      // Check cache first
      const cacheKey = `search:suggestions:${query}:${limit}`;
      const cachedSuggestions = await cache.get(cacheKey);
      if (cachedSuggestions) {
        return res.json(cachedSuggestions);
      }

      // Get suggestions from recent searches and popular videos
      const { prisma } = await import('../services/database');
      
      const [popularVideos, popularChannels] = await Promise.all([
        prisma.video.findMany({
          where: {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { tags: { hasSome: [query] } },
            ],
            status: 'PUBLISHED',
            privacy: 'PUBLIC',
          },
          select: {
            title: true,
            views: true,
          },
          orderBy: { views: 'desc' },
          take: limit,
        }),
        prisma.channel.findMany({
          where: {
            name: { contains: query, mode: 'insensitive' },
            isActive: true,
          },
          select: {
            name: true,
            _count: {
              select: {
                subscriptions: true,
              },
            },
          },
          orderBy: {
            subscriptions: {
              _count: 'desc',
            },
          },
          take: limit,
        }),
      ]);

      // Combine and format suggestions
      const suggestions = [
        ...popularVideos.map(video => ({
          text: video.title,
          type: 'video',
          popularity: video.views,
        })),
        ...popularChannels.map(channel => ({
          text: channel.name,
          type: 'channel',
          popularity: channel._count.subscriptions,
        })),
      ]
        .sort((a, b) => b.popularity - a.popularity)
        .slice(0, limit)
        .map(item => item.text);

      // Remove duplicates
      const uniqueSuggestions = [...new Set(suggestions)];

      const result = {
        query,
        suggestions: uniqueSuggestions,
      };

      // Cache for 30 minutes
      await cache.set(cacheKey, result, 1800);

      res.json(result);
    } catch (error) {
      logger.error('Search suggestions error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   GET /api/search/trending
// @desc    Get trending search terms
// @access  Public
router.get('/trending', async (req, res) => {
  try {
    // Check cache first
    const cacheKey = 'search:trending';
    const cachedTrending = await cache.get(cacheKey);
    if (cachedTrending) {
      return res.json(cachedTrending);
    }

    // Get trending based on recent popular videos and channels
    const { prisma } = await import('../services/database');
    
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const [trendingVideos, trendingChannels] = await Promise.all([
      prisma.video.findMany({
        where: {
          createdAt: { gte: sevenDaysAgo },
          status: 'PUBLISHED',
          privacy: 'PUBLIC',
        },
        select: {
          title: true,
          tags: true,
          views: true,
        },
        orderBy: { views: 'desc' },
        take: 20,
      }),
      prisma.channel.findMany({
        where: {
          createdAt: { gte: sevenDaysAgo },
          isActive: true,
        },
        select: {
          name: true,
          _count: {
            select: {
              subscriptions: true,
            },
          },
        },
        orderBy: {
          subscriptions: {
            _count: 'desc',
          },
        },
        take: 10,
      }),
    ]);

    // Extract trending terms
    const trendingTerms = new Map<string, number>();
    
    // From video titles and tags
    trendingVideos.forEach(video => {
      // Split title into words
      const titleWords = video.title.toLowerCase().split(/\W+/).filter(word => word.length > 2);
      titleWords.forEach(word => {
        trendingTerms.set(word, (trendingTerms.get(word) || 0) + video.views);
      });
      
      // Add tags
      video.tags.forEach(tag => {
        trendingTerms.set(tag.toLowerCase(), (trendingTerms.get(tag.toLowerCase()) || 0) + video.views);
      });
    });
    
    // From channel names
    trendingChannels.forEach(channel => {
      const nameWords = channel.name.toLowerCase().split(/\W+/).filter(word => word.length > 2);
      nameWords.forEach(word => {
        trendingTerms.set(word, (trendingTerms.get(word) || 0) + channel._count.subscriptions * 10);
      });
    });

    // Sort and get top terms
    const sortedTerms = Array.from(trendingTerms.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([term]) => term);

    const result = {
      trending: sortedTerms,
      updatedAt: new Date(),
    };

    // Cache for 1 hour
    await cache.set(cacheKey, result, 3600);

    res.json(result);
  } catch (error) {
    logger.error('Trending search error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

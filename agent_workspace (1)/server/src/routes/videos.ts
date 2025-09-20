import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { redis } from '../services/redis';
import { trackVideoView } from '../services/analytics';
import { getVideoRecommendations } from '../services/recommendations';
import { generateVideoThumbnail } from '../services/videoProcessing';

const router = Router();
const prisma = new PrismaClient();

// Validation schemas
const videoQuerySchema = z.object({
  page: z.string().optional().transform(val => val ? parseInt(val) : 1),
  limit: z.string().optional().transform(val => val ? parseInt(val) : 20),
  category: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['newest', 'oldest', 'popular', 'trending']).optional().default('newest'),
  channelId: z.string().optional(),
});

const videoUpdateSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).max(10).optional(),
  visibility: z.enum(['public', 'unlisted', 'private']).optional(),
});

const commentSchema = z.object({
  content: z.string().min(1).max(500),
  parentId: z.string().optional(),
});

// Get videos with filtering and pagination
router.get('/', validateRequest(videoQuerySchema, 'query'), async (req, res) => {
  try {
    const { page, limit, category, search, sort, channelId } = req.query as any;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {
      status: 'published',
      visibility: 'public',
    };

    if (category) {
      where.category = category;
    }

    if (channelId) {
      where.channelId = channelId;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { tags: { hasSome: [search] } },
      ];
    }

    // Build order by clause
    let orderBy: any = { createdAt: 'desc' };
    switch (sort) {
      case 'oldest':
        orderBy = { createdAt: 'asc' };
        break;
      case 'popular':
        orderBy = { views: 'desc' };
        break;
      case 'trending':
        // Trending algorithm: recent videos with high engagement
        orderBy = [
          { createdAt: 'desc' },
          { views: 'desc' },
          { likes: 'desc' },
        ];
        break;
    }

    const [videos, totalCount] = await Promise.all([
      prisma.video.findMany({
        where,
        orderBy,
        skip,
        take: limit,
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
              comments: true,
            },
          },
        },
      }),
      prisma.video.count({ where }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      videos,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error('Get videos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single video
router.get('/:id', optionalAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const video = await prisma.video.findUnique({
      where: { id },
      include: {
        channel: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
            banner: true,
            description: true,
            isVerified: true,
            subscriberCount: true,
            _count: {
              select: {
                videos: {
                  where: {
                    status: 'published',
                    visibility: 'public',
                  },
                },
              },
            },
          },
        },
        likes: userId ? {
          where: { userId },
          select: { id: true, isLike: true },
        } : false,
        _count: {
          select: {
            comments: true,
            likes: {
              where: { isLike: true },
            },
            dislikes: {
              where: { isLike: false },
            },
          },
        },
      },
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Check if user can view this video
    if (video.visibility === 'private' && video.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get user's subscription status if authenticated
    let isSubscribed = false;
    if (userId && video.channel.id !== userId) {
      const subscription = await prisma.subscription.findUnique({
        where: {
          subscriberId_channelId: {
            subscriberId: userId,
            channelId: video.channel.id,
          },
        },
      });
      isSubscribed = !!subscription;
    }

    // Get recommendations
    const recommendations = await getVideoRecommendations(video.id, userId);

    res.json({
      ...video,
      isLiked: video.likes?.[0]?.isLike ?? null,
      likeCount: video._count.likes,
      dislikeCount: video._count.dislikes,
      commentCount: video._count.comments,
      channel: {
        ...video.channel,
        isSubscribed,
        videoCount: video.channel._count.videos,
      },
      recommendations,
    });
  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update video
router.put('/:id', authMiddleware, validateRequest(videoUpdateSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const updateData = req.body;

    // Check if user owns the video
    const video = await prisma.video.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (video.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updatedVideo = await prisma.video.update({
      where: { id },
      data: {
        ...updateData,
        updatedAt: new Date(),
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
      },
    });

    res.json(updatedVideo);
  } catch (error) {
    console.error('Update video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete video
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // Check if user owns the video
    const video = await prisma.video.findUnique({
      where: { id },
      select: { userId: true, videoUrl: true, thumbnail: true },
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (video.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete video from database
    await prisma.video.delete({ where: { id } });

    // TODO: Delete video files from S3
    // await deleteVideoFiles(video.videoUrl, video.thumbnail);

    res.json({ message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Track video view
router.post('/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    const { watchTime } = req.body;
    const ip = req.ip || req.connection.remoteAddress;

    // Check if view is valid (prevent spam)
    const viewKey = `view:${id}:${ip}`;
    const existingView = await redis.get(viewKey);
    
    if (!existingView) {
      // Track the view
      await trackVideoView(id, ip, watchTime);
      
      // Set cooldown (5 minutes)
      await redis.setex(viewKey, 300, '1');
      
      // Increment view count
      await prisma.video.update({
        where: { id },
        data: { views: { increment: 1 } },
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Track view error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Like/Unlike video
router.post('/:id/like', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;

    // Check if video exists
    const video = await prisma.video.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Check existing like/dislike
    const existingLike = await prisma.videoLike.findUnique({
      where: {
        userId_videoId: {
          userId,
          videoId: id,
        },
      },
    });

    if (existingLike) {
      if (existingLike.isLike) {
        // Remove like
        await prisma.videoLike.delete({
          where: { id: existingLike.id },
        });
        await prisma.video.update({
          where: { id },
          data: { likes: { decrement: 1 } },
        });
      } else {
        // Change dislike to like
        await prisma.videoLike.update({
          where: { id: existingLike.id },
          data: { isLike: true },
        });
        await prisma.video.update({
          where: { id },
          data: {
            likes: { increment: 1 },
            dislikes: { decrement: 1 },
          },
        });
      }
    } else {
      // Create new like
      await prisma.videoLike.create({
        data: {
          userId,
          videoId: id,
          isLike: true,
        },
      });
      await prisma.video.update({
        where: { id },
        data: { likes: { increment: 1 } },
      });
    }

    // Get updated video with counts
    const updatedVideo = await prisma.video.findUnique({
      where: { id },
      select: {
        id: true,
        likes: true,
        dislikes: true,
        _count: {
          select: {
            likes: {
              where: { isLike: true },
            },
            dislikes: {
              where: { isLike: false },
            },
          },
        },
      },
    });

    res.json({
      ...updatedVideo,
      likeCount: updatedVideo!._count.likes,
      dislikeCount: updatedVideo!._count.dislikes,
    });
  } catch (error) {
    console.error('Like video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Dislike video
router.post('/:id/dislike', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;

    // Check if video exists
    const video = await prisma.video.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Check existing like/dislike
    const existingLike = await prisma.videoLike.findUnique({
      where: {
        userId_videoId: {
          userId,
          videoId: id,
        },
      },
    });

    if (existingLike) {
      if (!existingLike.isLike) {
        // Remove dislike
        await prisma.videoLike.delete({
          where: { id: existingLike.id },
        });
        await prisma.video.update({
          where: { id },
          data: { dislikes: { decrement: 1 } },
        });
      } else {
        // Change like to dislike
        await prisma.videoLike.update({
          where: { id: existingLike.id },
          data: { isLike: false },
        });
        await prisma.video.update({
          where: { id },
          data: {
            likes: { decrement: 1 },
            dislikes: { increment: 1 },
          },
        });
      }
    } else {
      // Create new dislike
      await prisma.videoLike.create({
        data: {
          userId,
          videoId: id,
          isLike: false,
        },
      });
      await prisma.video.update({
        where: { id },
        data: { dislikes: { increment: 1 } },
      });
    }

    // Get updated video with counts
    const updatedVideo = await prisma.video.findUnique({
      where: { id },
      select: {
        id: true,
        likes: true,
        dislikes: true,
        _count: {
          select: {
            likes: {
              where: { isLike: true },
            },
            dislikes: {
              where: { isLike: false },
            },
          },
        },
      },
    });

    res.json({
      ...updatedVideo,
      likeCount: updatedVideo!._count.likes,
      dislikeCount: updatedVideo!._count.dislikes,
    });
  } catch (error) {
    console.error('Dislike video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get video comments
router.get('/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [comments, totalCount] = await Promise.all([
      prisma.comment.findMany({
        where: {
          videoId: id,
          parentId: null, // Top-level comments only
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              avatar: true,
              channel: {
                select: {
                  isVerified: true,
                },
              },
            },
          },
          replies: {
            take: 3, // Show first 3 replies
            orderBy: { createdAt: 'asc' },
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  avatar: true,
                  channel: {
                    select: {
                      isVerified: true,
                    },
                  },
                },
              },
            },
          },
          _count: {
            select: {
              replies: true,
              likes: {
                where: { isLike: true },
              },
            },
          },
        },
      }),
      prisma.comment.count({
        where: {
          videoId: id,
          parentId: null,
        },
      }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      comments,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add comment
router.post('/:id/comments', authMiddleware, validateRequest(commentSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const { content, parentId } = req.body;

    // Check if video exists
    const video = await prisma.video.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // If it's a reply, check if parent comment exists
    if (parentId) {
      const parentComment = await prisma.comment.findUnique({
        where: { id: parentId },
        select: { id: true, videoId: true },
      });

      if (!parentComment || parentComment.videoId !== id) {
        return res.status(400).json({ error: 'Invalid parent comment' });
      }
    }

    const comment = await prisma.comment.create({
      data: {
        content,
        userId,
        videoId: id,
        parentId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
            channel: {
              select: {
                isVerified: true,
              },
            },
          },
        },
        _count: {
          select: {
            replies: true,
            likes: {
              where: { isLike: true },
            },
          },
        },
      },
    });

    res.status(201).json(comment);
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

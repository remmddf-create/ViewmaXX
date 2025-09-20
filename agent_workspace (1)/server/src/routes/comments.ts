import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../services/database';
import { cache } from '../services/redis';
import logger from '../utils/logger';

const router = express.Router();

// @route   GET /api/comments/video/:videoId
// @desc    Get comments for a video
// @access  Public
router.get(
  '/video/:videoId',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('sort').optional().isIn(['newest', 'oldest', 'popular']),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { videoId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const sort = req.query.sort as string || 'newest';
      const skip = (page - 1) * limit;

      // Check if video exists and is public
      const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: { privacy: true, status: true },
      });

      if (!video || video.status !== 'PUBLISHED' || video.privacy !== 'PUBLIC') {
        return res.status(404).json({ error: 'Video not found' });
      }

      // Build order by clause
      let orderBy: any;
      switch (sort) {
        case 'oldest':
          orderBy = { createdAt: 'asc' };
          break;
        case 'popular':
          orderBy = { likes: 'desc' };
          break;
        default:
          orderBy = { createdAt: 'desc' };
      }

      const [comments, total] = await Promise.all([
        prisma.comment.findMany({
          where: {
            videoId,
            parentId: null, // Only top-level comments
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
            replies: {
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
              orderBy: { createdAt: 'asc' },
              take: 3, // Show first 3 replies
            },
            _count: {
              select: {
                replies: true,
              },
            },
          },
          skip,
          take: limit,
          orderBy,
        }),
        prisma.comment.count({
          where: {
            videoId,
            parentId: null,
          },
        }),
      ]);

      res.json({
        comments,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('Get comments error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   GET /api/comments/:id/replies
// @desc    Get replies for a comment
// @access  Public
router.get('/:id/replies', async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const [replies, total] = await Promise.all([
      prisma.comment.findMany({
        where: { parentId: id },
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
        orderBy: { createdAt: 'asc' },
      }),
      prisma.comment.count({ where: { parentId: id } }),
    ]);

    res.json({
      replies,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('Get replies error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/comments
// @desc    Create a comment
// @access  Private
router.post(
  '/',
  authenticate,
  [
    body('content').isLength({ min: 1, max: 1000 }).trim(),
    body('videoId').isUUID(),
    body('parentId').optional().isUUID(),
  ],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { content, videoId, parentId } = req.body;
      const userId = req.user!.id;

      // Check if video exists and allows comments
      const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: { 
          id: true,
          privacy: true, 
          status: true,
          userId: true,
        },
      });

      if (!video || video.status !== 'PUBLISHED') {
        return res.status(404).json({ error: 'Video not found' });
      }

      // Check if parent comment exists (for replies)
      if (parentId) {
        const parentComment = await prisma.comment.findUnique({
          where: { id: parentId },
          select: { videoId: true },
        });

        if (!parentComment || parentComment.videoId !== videoId) {
          return res.status(400).json({ error: 'Invalid parent comment' });
        }
      }

      // Create comment
      const comment = await prisma.comment.create({
        data: {
          content,
          userId,
          videoId,
          parentId,
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
          replies: {
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
            orderBy: { createdAt: 'asc' },
          },
          _count: {
            select: {
              replies: true,
            },
          },
        },
      });

      // Send notification to video owner (if not commenting on own video)
      if (video.userId !== userId) {
        await prisma.notification.create({
          data: {
            title: 'New comment on your video',
            message: `${req.user!.username} commented: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
            type: 'COMMENT',
            userId: video.userId,
            data: {
              videoId,
              commentId: comment.id,
              commenterUsername: req.user!.username,
            },
          },
        });
      }

      // If it's a reply, notify the parent comment author
      if (parentId) {
        const parentComment = await prisma.comment.findUnique({
          where: { id: parentId },
          select: { userId: true },
        });

        if (parentComment && parentComment.userId !== userId) {
          await prisma.notification.create({
            data: {
              title: 'Someone replied to your comment',
              message: `${req.user!.username} replied: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
              type: 'COMMENT',
              userId: parentComment.userId,
              data: {
                videoId,
                commentId: comment.id,
                parentCommentId: parentId,
                replierUsername: req.user!.username,
              },
            },
          });
        }
      }

      logger.info(`Comment created: ${comment.id} by user ${userId}`);
      res.status(201).json({ message: 'Comment created successfully', comment });
    } catch (error) {
      logger.error('Create comment error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   PUT /api/comments/:id
// @desc    Update a comment
// @access  Private
router.put(
  '/:id',
  authenticate,
  [body('content').isLength({ min: 1, max: 1000 }).trim()],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { content } = req.body;
      const userId = req.user!.id;

      // Check if comment exists and user owns it
      const comment = await prisma.comment.findUnique({
        where: { id },
        select: { userId: true },
      });

      if (!comment) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      if (comment.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Update comment
      const updatedComment = await prisma.comment.update({
        where: { id },
        data: { content },
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
      });

      logger.info(`Comment updated: ${id} by user ${userId}`);
      res.json({ message: 'Comment updated successfully', comment: updatedComment });
    } catch (error) {
      logger.error('Update comment error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   DELETE /api/comments/:id
// @desc    Delete a comment
// @access  Private
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Check if comment exists
    const comment = await prisma.comment.findUnique({
      where: { id },
      include: {
        video: {
          select: { userId: true },
        },
      },
    });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Check if user owns the comment or the video
    if (comment.userId !== userId && comment.video.userId !== userId && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete comment and all its replies
    await prisma.comment.deleteMany({
      where: {
        OR: [
          { id },
          { parentId: id },
        ],
      },
    });

    logger.info(`Comment deleted: ${id} by user ${userId}`);
    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    logger.error('Delete comment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/comments/:id/like
// @desc    Like/unlike a comment
// @access  Private
router.post('/:id/like', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Check if comment exists
    const comment = await prisma.comment.findUnique({
      where: { id },
      select: { id: true, likes: true },
    });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Check if user already liked this comment
    const existingLike = await prisma.like.findFirst({
      where: {
        userId,
        // Note: We would need to add commentId to the Like model for this to work
        // For now, this is a placeholder
      },
    });

    let isLiked = false;
    if (existingLike) {
      // Unlike
      await prisma.like.delete({
        where: { id: existingLike.id },
      });
      
      await prisma.comment.update({
        where: { id },
        data: { likes: { decrement: 1 } },
      });
    } else {
      // Like
      // Note: This would need to be implemented properly with commentId in Like model
      await prisma.comment.update({
        where: { id },
        data: { likes: { increment: 1 } },
      });
      isLiked = true;
    }

    res.json({ 
      message: isLiked ? 'Comment liked' : 'Comment unliked',
      isLiked,
    });
  } catch (error) {
    logger.error('Like comment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../services/database';
import { cache } from '../services/redis';
import logger from '../utils/logger';

const router = express.Router();

// @route   GET /api/playlists
// @desc    Get user's playlists
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

      const [playlists, total] = await Promise.all([
        prisma.playlist.findMany({
          where: {
            userId,
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
                    id: true,
                    title: true,
                    thumbnail: true,
                    duration: true,
                  },
                },
              },
              orderBy: { position: 'asc' },
            },
          },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.playlist.count({
          where: {
            userId,
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
      logger.error('Get playlists error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   GET /api/playlists/:id
// @desc    Get playlist by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const playlist = await prisma.playlist.findUnique({
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
          select: {
            id: true,
            name: true,
            avatar: true,
            isVerified: true,
          },
        },
        items: {
          include: {
            video: {
              select: {
                id: true,
                title: true,
                description: true,
                thumbnail: true,
                duration: true,
                views: true,
                createdAt: true,
                channel: {
                  select: {
                    id: true,
                    name: true,
                    avatar: true,
                  },
                },
              },
            },
          },
          orderBy: { position: 'asc' },
        },
        _count: {
          select: {
            items: true,
          },
        },
      },
    });

    if (!playlist || playlist.status !== 'ACTIVE') {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    // Check privacy
    if (playlist.privacy === 'PRIVATE') {
      return res.status(403).json({ error: 'This playlist is private' });
    }

    res.json(playlist);
  } catch (error) {
    logger.error('Get playlist error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/playlists
// @desc    Create playlist
// @access  Private
router.post(
  '/',
  authenticate,
  [
    body('name').isLength({ min: 1, max: 100 }).trim(),
    body('description').optional().isLength({ max: 500 }).trim(),
    body('privacy').optional().isIn(['PUBLIC', 'UNLISTED', 'PRIVATE']),
  ],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, description, privacy = 'PUBLIC' } = req.body;
      const userId = req.user!.id;

      // Get user's channel
      const channel = await prisma.channel.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (!channel) {
        return res.status(400).json({ error: 'Channel not found' });
      }

      const playlist = await prisma.playlist.create({
        data: {
          name,
          description,
          privacy,
          userId,
          channelId: channel.id,
        },
        include: {
          _count: {
            select: {
              items: true,
            },
          },
        },
      });

      logger.info(`Playlist created: ${playlist.id} by user ${userId}`);
      res.status(201).json({
        message: 'Playlist created successfully',
        playlist,
      });
    } catch (error) {
      logger.error('Create playlist error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   PUT /api/playlists/:id
// @desc    Update playlist
// @access  Private
router.put(
  '/:id',
  authenticate,
  [
    body('name').optional().isLength({ min: 1, max: 100 }).trim(),
    body('description').optional().isLength({ max: 500 }).trim(),
    body('privacy').optional().isIn(['PUBLIC', 'UNLISTED', 'PRIVATE']),
  ],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { name, description, privacy } = req.body;
      const userId = req.user!.id;

      // Check if user owns the playlist
      const playlist = await prisma.playlist.findUnique({
        where: { id },
        select: { userId: true },
      });

      if (!playlist || playlist.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const updatedPlaylist = await prisma.playlist.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(privacy && { privacy }),
        },
        include: {
          _count: {
            select: {
              items: true,
            },
          },
        },
      });

      logger.info(`Playlist updated: ${id} by user ${userId}`);
      res.json({
        message: 'Playlist updated successfully',
        playlist: updatedPlaylist,
      });
    } catch (error) {
      logger.error('Update playlist error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   DELETE /api/playlists/:id
// @desc    Delete playlist
// @access  Private
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Check if user owns the playlist
    const playlist = await prisma.playlist.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!playlist || playlist.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Soft delete
    await prisma.playlist.update({
      where: { id },
      data: { status: 'DELETED' },
    });

    logger.info(`Playlist deleted: ${id} by user ${userId}`);
    res.json({ message: 'Playlist deleted successfully' });
  } catch (error) {
    logger.error('Delete playlist error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/playlists/:id/videos
// @desc    Add video to playlist
// @access  Private
router.post(
  '/:id/videos',
  authenticate,
  [body('videoId').isUUID()],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { videoId } = req.body;
      const userId = req.user!.id;

      // Check if user owns the playlist
      const playlist = await prisma.playlist.findUnique({
        where: { id },
        select: { userId: true },
      });

      if (!playlist || playlist.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Check if video exists
      const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: { id: true, status: true },
      });

      if (!video || video.status !== 'PUBLISHED') {
        return res.status(404).json({ error: 'Video not found' });
      }

      // Check if video is already in playlist
      const existingItem = await prisma.playlistItem.findUnique({
        where: {
          playlistId_videoId: {
            playlistId: id,
            videoId,
          },
        },
      });

      if (existingItem) {
        return res.status(400).json({ error: 'Video already in playlist' });
      }

      // Get next position
      const lastItem = await prisma.playlistItem.findFirst({
        where: { playlistId: id },
        orderBy: { position: 'desc' },
        select: { position: true },
      });

      const position = lastItem ? lastItem.position + 1 : 1;

      // Add video to playlist
      const playlistItem = await prisma.playlistItem.create({
        data: {
          playlistId: id,
          videoId,
          position,
        },
        include: {
          video: {
            select: {
              id: true,
              title: true,
              thumbnail: true,
              duration: true,
              views: true,
              createdAt: true,
            },
          },
        },
      });

      logger.info(`Video ${videoId} added to playlist ${id}`);
      res.status(201).json({
        message: 'Video added to playlist successfully',
        item: playlistItem,
      });
    } catch (error) {
      logger.error('Add video to playlist error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   DELETE /api/playlists/:id/videos/:videoId
// @desc    Remove video from playlist
// @access  Private
router.delete('/:id/videos/:videoId', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id, videoId } = req.params;
    const userId = req.user!.id;

    // Check if user owns the playlist
    const playlist = await prisma.playlist.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!playlist || playlist.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Remove video from playlist
    const deletedItem = await prisma.playlistItem.deleteMany({
      where: {
        playlistId: id,
        videoId,
      },
    });

    if (deletedItem.count === 0) {
      return res.status(404).json({ error: 'Video not found in playlist' });
    }

    // Reorder remaining items
    const remainingItems = await prisma.playlistItem.findMany({
      where: { playlistId: id },
      orderBy: { position: 'asc' },
    });

    for (let i = 0; i < remainingItems.length; i++) {
      await prisma.playlistItem.update({
        where: { id: remainingItems[i].id },
        data: { position: i + 1 },
      });
    }

    logger.info(`Video ${videoId} removed from playlist ${id}`);
    res.json({ message: 'Video removed from playlist successfully' });
  } catch (error) {
    logger.error('Remove video from playlist error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   PUT /api/playlists/:id/reorder
// @desc    Reorder playlist items
// @access  Private
router.put(
  '/:id/reorder',
  authenticate,
  [body('items').isArray()],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { items } = req.body; // Array of { id, position }
      const userId = req.user!.id;

      // Check if user owns the playlist
      const playlist = await prisma.playlist.findUnique({
        where: { id },
        select: { userId: true },
      });

      if (!playlist || playlist.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Update positions
      for (const item of items) {
        await prisma.playlistItem.update({
          where: { id: item.id },
          data: { position: item.position },
        });
      }

      logger.info(`Playlist ${id} reordered by user ${userId}`);
      res.json({ message: 'Playlist reordered successfully' });
    } catch (error) {
      logger.error('Reorder playlist error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

export default router;

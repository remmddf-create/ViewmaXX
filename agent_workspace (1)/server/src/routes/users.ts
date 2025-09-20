import express from 'express';
import { body, validationResult, query } from 'express-validator';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
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

// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
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

// @route   GET /api/users
// @desc    Get all users (admin only)
// @access  Private (Admin)
router.get(
  '/',
  authenticate,
  authorize('ADMIN', 'SUPER_ADMIN'),
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('search').optional().trim(),
    query('role').optional().isIn(['USER', 'CREATOR', 'MODERATOR', 'ADMIN']),
    query('isVerified').optional().isBoolean(),
    query('isActive').optional().isBoolean(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const search = req.query.search as string;
      const role = req.query.role as string;
      const isVerified = req.query.isVerified === 'true';
      const isActive = req.query.isActive === 'true';
      const skip = (page - 1) * limit;

      const where: any = {};

      if (search) {
        where.OR = [
          { username: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (role) where.role = role;
      if (typeof isVerified === 'boolean') where.isVerified = isVerified;
      if (typeof isActive === 'boolean') where.isActive = isActive;

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
            isVerified: true,
            isActive: true,
            role: true,
            createdAt: true,
            updatedAt: true,
            channel: {
              select: {
                id: true,
                name: true,
                subscriberCount: true,
              },
            },
            _count: {
              select: {
                videos: true,
                subscribers: true,
              },
            },
          },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.user.count({ where }),
      ]);

      res.json({
        users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('Get users error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   GET /api/users/:id
// @desc    Get user by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check cache first
    const cacheKey = `user:${id}`;
    const cachedUser = await cache.get(cacheKey);
    if (cachedUser) {
      return res.json(cachedUser);
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        avatar: true,
        coverImage: true,
        isVerified: true,
        role: true,
        createdAt: true,
        channel: {
          include: {
            _count: {
              select: {
                subscriptions: true,
                videos: true,
              },
            },
          },
        },
        _count: {
          select: {
            videos: true,
            subscribers: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Cache the result
    await cache.set(cacheKey, user, 300); // 5 minutes

    res.json(user);
  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   PUT /api/users/profile
// @desc    Update user profile
// @access  Private
router.put(
  '/profile',
  authenticate,
  [
    body('username').optional().isLength({ min: 3, max: 30 }).trim(),
    body('firstName').optional().trim(),
    body('lastName').optional().trim(),
    body('bio').optional().isLength({ max: 500 }).trim(),
  ],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { username, firstName, lastName, bio } = req.body;
      const userId = req.user!.id;

      // Check if username is already taken
      if (username) {
        const existingUser = await prisma.user.findFirst({
          where: {
            username,
            NOT: { id: userId },
          },
        });

        if (existingUser) {
          return res.status(400).json({ error: 'Username already taken' });
        }
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(username && { username }),
          ...(firstName && { firstName }),
          ...(lastName && { lastName }),
        },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          coverImage: true,
          isVerified: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Update channel name if username changed
      if (username) {
        await prisma.channel.updateMany({
          where: { userId },
          data: { name: username },
        });
      }

      // Clear cache
      await cache.del(`user:${userId}`);

      logger.info(`User profile updated: ${updatedUser.email}`);
      res.json({ message: 'Profile updated successfully', user: updatedUser });
    } catch (error) {
      logger.error('Update profile error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   POST /api/users/avatar
// @desc    Upload user avatar
// @access  Private
router.post(
  '/avatar',
  authenticate,
  upload.single('avatar'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const userId = req.user!.id;
      const avatarUrl = await uploadToS3(req.file, 'avatars');

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { avatar: avatarUrl },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          coverImage: true,
          isVerified: true,
          role: true,
        },
      });

      // Clear cache
      await cache.del(`user:${userId}`);

      logger.info(`Avatar updated for user: ${updatedUser.email}`);
      res.json({ message: 'Avatar updated successfully', user: updatedUser });
    } catch (error) {
      logger.error('Upload avatar error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   POST /api/users/cover
// @desc    Upload user cover image
// @access  Private
router.post(
  '/cover',
  authenticate,
  upload.single('cover'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const userId = req.user!.id;
      const coverUrl = await uploadToS3(req.file, 'covers');

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { coverImage: coverUrl },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          coverImage: true,
          isVerified: true,
          role: true,
        },
      });

      // Clear cache
      await cache.del(`user:${userId}`);

      logger.info(`Cover image updated for user: ${updatedUser.email}`);
      res.json({ message: 'Cover image updated successfully', user: updatedUser });
    } catch (error) {
      logger.error('Upload cover error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   PUT /api/users/password
// @desc    Change password
// @access  Private
router.put(
  '/password',
  authenticate,
  [
    body('currentPassword').exists(),
    body('newPassword').isLength({ min: 6 }),
  ],
  async (req: AuthRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { currentPassword, newPassword } = req.body;
      const userId = req.user!.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true, email: true },
      });

      if (!user?.passwordHash) {
        return res.status(400).json({ error: 'Cannot change password for social login accounts' });
      }

      // Verify current password
      const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isMatch) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      // Hash new password
      const salt = await bcrypt.genSalt(12);
      const newPasswordHash = await bcrypt.hash(newPassword, salt);

      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash },
      });

      logger.info(`Password changed for user: ${user.email}`);
      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      logger.error('Change password error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// @route   DELETE /api/users/account
// @desc    Delete user account
// @access  Private
router.delete('/account', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    // Soft delete - deactivate account
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    // Clear cache
    await cache.del(`user:${userId}`);

    logger.info(`Account deactivated for user: ${req.user!.email}`);
    res.json({ message: 'Account deactivated successfully' });
  } catch (error) {
    logger.error('Delete account error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   GET /api/users/:id/videos
// @desc    Get user's videos
// @access  Public
router.get('/:id/videos', async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [videos, total] = await Promise.all([
      prisma.video.findMany({
        where: {
          userId: id,
          status: 'PUBLISHED',
          privacy: 'PUBLIC',
        },
        select: {
          id: true,
          title: true,
          description: true,
          thumbnail: true,
          duration: true,
          views: true,
          likes: true,
          createdAt: true,
          channel: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.video.count({
        where: {
          userId: id,
          status: 'PUBLISHED',
          privacy: 'PUBLIC',
        },
      }),
    ]);

    res.json({
      videos,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('Get user videos error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

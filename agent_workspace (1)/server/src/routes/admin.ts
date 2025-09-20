import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { redis } from '../services/redis';

const router = Router();
const prisma = new PrismaClient();

// Apply admin middleware to all routes
router.use(authMiddleware);
router.use(adminMiddleware);

// Admin dashboard stats
router.get('/dashboard', async (req, res) => {
  try {
    const [userStats, videoStats, revenue] = await Promise.all([
      // User statistics
      prisma.user.aggregate({
        _count: { id: true },
      }),
      
      // Video statistics
      prisma.video.aggregate({
        _count: { id: true },
        _sum: { views: true },
      }),
      
      // Revenue statistics (if monetization is enabled)
      prisma.monetization.aggregate({
        _sum: { totalEarnings: true },
        where: {
          status: 'approved',
        },
      }),
    ]);

    // Get recent activity
    const recentUsers = await prisma.user.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
        isVerified: true,
      },
    });

    const recentVideos = await prisma.video.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        views: true,
        status: true,
        createdAt: true,
        channel: {
          select: {
            name: true,
            username: true,
          },
        },
      },
    });

    // Get system stats from Redis
    const systemStats = {
      activeConnections: await redis.get('stats:active_connections') || '0',
      todayUploads: await redis.get('stats:today_uploads') || '0',
      todayViews: await redis.get('stats:today_views') || '0',
    };

    res.json({
      stats: {
        totalUsers: userStats._count.id,
        totalVideos: videoStats._count.id,
        totalViews: videoStats._sum.views || 0,
        totalRevenue: revenue._sum.totalEarnings || 0,
        ...systemStats,
      },
      recentActivity: {
        users: recentUsers,
        videos: recentVideos,
      },
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User management
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const status = req.query.status as string;
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

    if (status === 'verified') {
      where.isVerified = true;
    } else if (status === 'unverified') {
      where.isVerified = false;
    } else if (status === 'suspended') {
      where.isSuspended = true;
    }

    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          channel: {
            select: {
              subscriberCount: true,
              videoCount: true,
            },
          },
          _count: {
            select: {
              videos: true,
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      users,
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
    console.error('Admin get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Suspend/unsuspend user
router.patch('/users/:id/suspend', async (req, res) => {
  try {
    const { id } = req.params;
    const { suspend, reason } = req.body;

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, isSuspended: true, isAdmin: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.isAdmin) {
      return res.status(400).json({ error: 'Cannot suspend admin users' });
    }

    await prisma.user.update({
      where: { id },
      data: {
        isSuspended: suspend,
        suspendedAt: suspend ? new Date() : null,
        suspensionReason: suspend ? reason : null,
      },
    });

    // Log admin action
    await prisma.adminLog.create({
      data: {
        adminId: req.userId!,
        action: suspend ? 'SUSPEND_USER' : 'UNSUSPEND_USER',
        targetId: id,
        details: { reason },
      },
    });

    res.json({
      message: `User ${suspend ? 'suspended' : 'unsuspended'} successfully`,
    });
  } catch (error) {
    console.error('Admin suspend user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Video management
router.get('/videos', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const status = req.query.status as string;
    const skip = (page - 1) * limit;

    const where: any = {};
    
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }

    const [videos, totalCount] = await Promise.all([
      prisma.video.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          channel: {
            select: {
              name: true,
              username: true,
              isVerified: true,
            },
          },
          _count: {
            select: {
              comments: true,
              likes: true,
              reports: true,
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
    console.error('Admin get videos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove video
router.delete('/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const video = await prisma.video.findUnique({
      where: { id },
      select: { id: true, title: true, userId: true },
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Remove video
    await prisma.video.delete({ where: { id } });

    // Log admin action
    await prisma.adminLog.create({
      data: {
        adminId: req.userId!,
        action: 'REMOVE_VIDEO',
        targetId: id,
        details: { reason, title: video.title },
      },
    });

    res.json({ message: 'Video removed successfully' });
  } catch (error) {
    console.error('Admin remove video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Monetization management
router.get('/monetization', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) {
      where.status = status;
    }

    const [applications, totalCount] = await Promise.all([
      prisma.monetization.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              channel: {
                select: {
                  name: true,
                  subscriberCount: true,
                  videoCount: true,
                  totalViews: true,
                },
              },
            },
          },
        },
      }),
      prisma.monetization.count({ where }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      applications,
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
    console.error('Admin get monetization error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve/reject monetization
router.patch('/monetization/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const application = await prisma.monetization.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
          },
        },
      },
    });

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Update application
    await prisma.monetization.update({
      where: { id },
      data: {
        status,
        reviewedAt: new Date(),
        reviewedBy: req.userId!,
        reviewNotes: reason,
      },
    });

    // Update user monetization status
    if (status === 'approved') {
      await prisma.user.update({
        where: { id: application.userId },
        data: {
          isMonetized: true,
          monetizationApprovedAt: new Date(),
        },
      });
    }

    // Log admin action
    await prisma.adminLog.create({
      data: {
        adminId: req.userId!,
        action: status === 'approved' ? 'APPROVE_MONETIZATION' : 'REJECT_MONETIZATION',
        targetId: application.userId,
        details: { reason },
      },
    });

    // TODO: Send notification email to user

    res.json({
      message: `Monetization application ${status} successfully`,
    });
  } catch (error) {
    console.error('Admin monetization review error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get reports
router.get('/reports', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const type = req.query.type as string;
    const status = req.query.status as string;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (type) {
      where.type = type;
    }
    if (status) {
      where.status = status;
    }

    const [reports, totalCount] = await Promise.all([
      prisma.report.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          reporter: {
            select: {
              id: true,
              username: true,
            },
          },
          video: {
            select: {
              id: true,
              title: true,
              channel: {
                select: {
                  name: true,
                  username: true,
                },
              },
            },
          },
          comment: {
            select: {
              id: true,
              content: true,
              user: {
                select: {
                  username: true,
                },
              },
            },
          },
        },
      }),
      prisma.report.count({ where }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      reports,
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
    console.error('Admin get reports error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle report
router.patch('/reports/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body;

    const validActions = ['dismiss', 'remove_content', 'warn_user', 'suspend_user'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const report = await prisma.report.findUnique({
      where: { id },
      include: {
        video: true,
        comment: true,
      },
    });

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Handle the action
    switch (action) {
      case 'remove_content':
        if (report.video) {
          await prisma.video.delete({ where: { id: report.videoId! } });
        } else if (report.comment) {
          await prisma.comment.delete({ where: { id: report.commentId! } });
        }
        break;
      
      case 'warn_user':
        // TODO: Implement user warning system
        break;
      
      case 'suspend_user':
        const targetUserId = report.video?.userId || report.comment?.userId;
        if (targetUserId) {
          await prisma.user.update({
            where: { id: targetUserId },
            data: {
              isSuspended: true,
              suspendedAt: new Date(),
              suspensionReason: reason,
            },
          });
        }
        break;
    }

    // Update report status
    await prisma.report.update({
      where: { id },
      data: {
        status: action === 'dismiss' ? 'dismissed' : 'resolved',
        resolvedAt: new Date(),
        resolvedBy: req.userId!,
        resolution: action,
        resolutionNotes: reason,
      },
    });

    // Log admin action
    await prisma.adminLog.create({
      data: {
        adminId: req.userId!,
        action: 'HANDLE_REPORT',
        targetId: report.id,
        details: { action, reason },
      },
    });

    res.json({ message: 'Report handled successfully' });
  } catch (error) {
    console.error('Admin handle report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get admin logs
router.get('/logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const action = req.query.action as string;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (action) {
      where.action = action;
    }

    const [logs, totalCount] = await Promise.all([
      prisma.adminLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      }),
      prisma.adminLog.count({ where }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      logs,
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
    console.error('Admin get logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

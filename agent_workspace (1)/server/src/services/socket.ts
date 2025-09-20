import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from './database';
import logger from '../utils/logger';

interface SocketUser {
  id: string;
  username: string;
  role: string;
}

interface AuthenticatedSocket extends Socket {
  user?: SocketUser;
}

interface Socket {
  id: string;
  join: (room: string) => void;
  leave: (room: string) => void;
  emit: (event: string, ...args: any[]) => void;
  broadcast: {
    to: (room: string) => {
      emit: (event: string, ...args: any[]) => void;
    };
  };
  to: (room: string) => {
    emit: (event: string, ...args: any[]) => void;
  };
  handshake: {
    auth: {
      token?: string;
    };
  };
}

export const setupSocketIO = (io: Server) => {
  // Authentication middleware
  io.use(async (socket: any, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          username: true,
          role: true,
          isActive: true,
        },
      });

      if (!user || !user.isActive) {
        return next(new Error('Authentication error'));
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  // Connection handling
  io.on('connection', (socket: AuthenticatedSocket) => {
    logger.info(`User connected: ${socket.user?.username} (${socket.id})`);

    // Join user to personal room for notifications
    socket.join(`user:${socket.user?.id}`);

    // Live streaming events
    socket.on('join-stream', (streamId: string) => {
      socket.join(`stream:${streamId}`);
      socket.broadcast.to(`stream:${streamId}`).emit('viewer-joined', {
        userId: socket.user?.id,
        username: socket.user?.username,
      });
    });

    socket.on('leave-stream', (streamId: string) => {
      socket.leave(`stream:${streamId}`);
      socket.broadcast.to(`stream:${streamId}`).emit('viewer-left', {
        userId: socket.user?.id,
        username: socket.user?.username,
      });
    });

    // Live chat events
    socket.on('chat-message', async (data: { streamId: string; message: string }) => {
      try {
        const { streamId, message } = data;
        
        // Save message to database
        const chatMessage = await prisma.chatMessage.create({
          data: {
            message,
            userId: socket.user!.id,
            liveStreamId: streamId,
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
          },
        });

        // Broadcast to all viewers
        io.to(`stream:${streamId}`).emit('new-chat-message', chatMessage);
      } catch (error) {
        logger.error('Chat message error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Video commenting in real-time
    socket.on('join-video', (videoId: string) => {
      socket.join(`video:${videoId}`);
    });

    socket.on('leave-video', (videoId: string) => {
      socket.leave(`video:${videoId}`);
    });

    socket.on('new-comment', async (data: { videoId: string; content: string; parentId?: string }) => {
      try {
        const { videoId, content, parentId } = data;
        
        const comment = await prisma.comment.create({
          data: {
            content,
            userId: socket.user!.id,
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
            },
          },
        });

        // Broadcast to all video viewers
        io.to(`video:${videoId}`).emit('comment-added', comment);
      } catch (error) {
        logger.error('Comment error:', error);
        socket.emit('error', { message: 'Failed to add comment' });
      }
    });

    // Typing indicators
    socket.on('typing-start', (data: { type: 'stream' | 'video'; id: string }) => {
      socket.broadcast.to(`${data.type}:${data.id}`).emit('user-typing', {
        userId: socket.user?.id,
        username: socket.user?.username,
      });
    });

    socket.on('typing-stop', (data: { type: 'stream' | 'video'; id: string }) => {
      socket.broadcast.to(`${data.type}:${data.id}`).emit('user-stop-typing', {
        userId: socket.user?.id,
      });
    });

    // Notification events
    socket.on('mark-notification-read', async (notificationId: string) => {
      try {
        await prisma.notification.update({
          where: {
            id: notificationId,
            userId: socket.user!.id,
          },
          data: {
            isRead: true,
          },
        });
        
        socket.emit('notification-marked-read', { notificationId });
      } catch (error) {
        logger.error('Notification mark read error:', error);
      }
    });

    // Admin events
    if (socket.user?.role === 'ADMIN' || socket.user?.role === 'SUPER_ADMIN') {
      socket.join('admin-room');

      socket.on('admin-broadcast', (data: { message: string; type: string }) => {
        io.emit('admin-announcement', {
          message: data.message,
          type: data.type,
          timestamp: new Date(),
        });
      });
    }

    // Disconnect handling
    socket.on('disconnect', () => {
      logger.info(`User disconnected: ${socket.user?.username} (${socket.id})`);
    });
  });

  return io;
};

// Utility functions for sending notifications
export const sendNotification = (io: Server, userId: string, notification: any) => {
  io.to(`user:${userId}`).emit('new-notification', notification);
};

export const broadcastToStream = (io: Server, streamId: string, event: string, data: any) => {
  io.to(`stream:${streamId}`).emit(event, data);
};

export const broadcastToVideo = (io: Server, videoId: string, event: string, data: any) => {
  io.to(`video:${videoId}`).emit(event, data);
};

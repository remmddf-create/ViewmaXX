import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import fileUpload from 'express-fileupload';

// Routes
import authRoutes from './routes/auth';
import videoRoutes from './routes/videos';
import userRoutes from './routes/users';
import channelRoutes from './routes/channels';
import adminRoutes from './routes/admin';
import uploadRoutes from './routes/upload';
import analyticsRoutes from './routes/analytics';
import liveRoutes from './routes/live';
import monetizationRoutes from './routes/monetization';

// Middleware
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/logger';

// Services
import { initializeRedis } from './services/redis';
import { initializeS3 } from './services/s3';
import { setupVideoProcessing } from './services/videoProcessing';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Initialize Prisma
const prisma = new PrismaClient();

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(fileUpload({
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB limit
  useTempFiles: true,
  tempFileDir: '/tmp/'
}));
app.use(limiter);
app.use(requestLogger);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'ViewmaXX API'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/users', userRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/live', liveRoutes);
app.use('/api/monetization', monetizationRoutes);
app.use('/api/admin', adminRoutes);

// Socket.IO for real-time features
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Live chat
  socket.on('join-live-chat', (streamId) => {
    socket.join(`live-${streamId}`);
  });

  socket.on('live-chat-message', (data) => {
    io.to(`live-${data.streamId}`).emit('live-chat-message', data);
  });

  // Video watch party
  socket.on('join-watch-party', (videoId) => {
    socket.join(`watch-${videoId}`);
  });

  socket.on('video-sync', (data) => {
    socket.to(`watch-${data.videoId}`).emit('video-sync', data);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.originalUrl 
  });
});

// Initialize services
async function initializeServices() {
  try {
    await prisma.$connect();
    console.log('✅ Database connected');
    
    await initializeRedis();
    console.log('✅ Redis connected');
    
    await initializeS3();
    console.log('✅ S3 initialized');
    
    await setupVideoProcessing();
    console.log('✅ Video processing setup complete');
    
  } catch (error) {
    console.error('❌ Failed to initialize services:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});

const PORT = process.env.PORT || 8000;

// Start server
initializeServices().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 ViewmaXX API Server running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
});

export { app, io, prisma };

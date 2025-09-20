# ViewmaXX Server

## Building the Docker Image

```bash
docker build -t viewmaxx-server .
```

## Running the Server

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## Environment Variables

Copy `.env.example` to `.env` and configure your environment variables.

## Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Seed database (optional)
npm run db:seed
```

## API Documentation

The server provides a comprehensive REST API for the ViewmaXX platform:

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/me` - Get current user

### Videos
- `GET /api/videos` - List videos
- `POST /api/videos/upload` - Upload video
- `GET /api/videos/:id` - Get video details

### Live Streaming
- `GET /api/live/streams` - List live streams
- `POST /api/live/streams` - Create stream
- `POST /api/live/streams/:id/start` - Start streaming

### Monetization
- `POST /api/monetization/apply` - Apply for monetization
- `GET /api/monetization/analytics` - Get revenue analytics
- `POST /api/monetization/payout` - Request payout

See individual route files for complete API documentation.

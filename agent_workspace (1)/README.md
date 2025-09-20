# ViewmaXX - Video Sharing Platform

![ViewmaXX Logo](https://via.placeholder.com/200x50/667eea/ffffff?text=ViewmaXX)

ViewmaXX is a modern, feature-rich video sharing platform built with the latest technologies. It provides content creators with powerful tools for uploading, managing, and monetizing their videos while offering viewers an engaging and seamless experience.

## 🌟 Features

### 📺 Core Video Features
- **Multi-format Upload**: Support for MP4, MKV, MOV, AVI, WMV
- **Adaptive Streaming**: Automatic transcoding to multiple resolutions (144p - 4K)
- **HLS/DASH Support**: Optimized video delivery
- **Custom Video Player**: Full-featured player with captions, speed control, quality settings
- **Live Streaming**: Real-time broadcasting with chat functionality
- **Video Analytics**: Comprehensive view and engagement metrics

### 👥 User & Channel Management
- **User Authentication**: Email/social login with email verification
- **Channel System**: Customizable profiles and branding
- **Subscription System**: Follow favorite creators
- **Notification System**: Real-time updates for activities
- **User Roles**: Admin, creator, and viewer permissions

### 💰 Monetization Features
- **Creator Requirements**: 100 subscribers + 50K qualified views in 30 days
- **Revenue Sharing**: Configurable platform fee (default 30%)
- **Multiple Payment Methods**: PayPal, Stripe, bank transfer
- **Analytics Dashboard**: Track earnings and performance
- **Ad Network Integration**: Google Ads, ExoClick support

### 🛠️ Admin Panel
- **User Management**: Suspend, verify, and manage users
- **Content Moderation**: Review and manage videos/comments
- **Monetization Approval**: Review creator applications
- **Platform Analytics**: Comprehensive insights and reporting
- **System Configuration**: Platform-wide settings

### 🔍 Discovery & Engagement
- **AI-Powered Recommendations**: Personalized content suggestions
- **Advanced Search**: Filter by tags, views, upload date
- **Trending Algorithm**: Promote viral content
- **Comments & Replies**: Threaded discussion system
- **Playlists**: Organize and share video collections
- **Social Features**: Likes, shares, subscriptions

## 🎨 Tech Stack

### Frontend
- **Framework**: Next.js 14 with App Router
- **Styling**: Tailwind CSS + Shadcn/ui components
- **State Management**: Zustand
- **Authentication**: JWT with refresh tokens
- **Video Player**: Custom HTML5 player with HLS.js
- **Real-time**: Socket.IO client

### Backend
- **Runtime**: Node.js with Express/NestJS
- **Database**: PostgreSQL with Prisma ORM
- **Caching**: Redis for sessions and caching
- **File Storage**: AWS S3 compatible storage
- **Video Processing**: FFmpeg for transcoding
- **Authentication**: JWT with bcrypt
- **Real-time**: Socket.IO server

### Infrastructure
- **Containerization**: Docker + Docker Compose
- **File Upload**: Multipart and presigned URL support
- **CDN**: CloudFlare or AWS CloudFront
- **Email**: SMTP with custom templates
- **Monitoring**: Request logging and error tracking

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 13+
- Redis 6+
- FFmpeg
- AWS S3 (or compatible storage)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/viewmaxx.git
   cd viewmaxx
   ```

2. **Install dependencies**
   ```bash
   # Install server dependencies
   cd server
   npm install
   
   # Install client dependencies
   cd ../client
   npm install
   ```

3. **Environment Setup**
   ```bash
   # Copy environment files
   cp .env.example .env
   
   # Configure your environment variables
   # Database, Redis, AWS S3, SMTP settings
   ```

4. **Database Setup**
   ```bash
   cd server
   npx prisma migrate dev
   npx prisma generate
   npx prisma db seed
   ```

5. **Start Development Servers**
   ```bash
   # Start backend (port 8000)
   cd server
   npm run dev
   
   # Start frontend (port 3000)
   cd ../client
   npm run dev
   ```

### Docker Setup

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## 📝 API Documentation

### Authentication Endpoints
- `POST /api/auth/signup` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - User logout

### Video Endpoints
- `GET /api/videos` - List videos with filters
- `GET /api/videos/:id` - Get video details
- `POST /api/videos` - Create new video
- `PUT /api/videos/:id` - Update video
- `DELETE /api/videos/:id` - Delete video
- `POST /api/videos/:id/like` - Like/unlike video
- `POST /api/videos/:id/view` - Track video view

### Upload Endpoints
- `POST /api/upload/presigned-url` - Get S3 presigned URL
- `POST /api/upload/confirm` - Confirm upload completion
- `POST /api/upload/video` - Direct video upload
- `POST /api/upload/thumbnail` - Upload custom thumbnail

### Admin Endpoints
- `GET /api/admin/dashboard` - Admin dashboard stats
- `GET /api/admin/users` - Manage users
- `GET /api/admin/videos` - Manage videos
- `GET /api/admin/monetization` - Review monetization apps

## 📋 Project Structure

```
viewmaxx/
├── client/                    # Next.js frontend
│   ├── src/
│   │   ├── app/               # App router pages
│   │   ├── components/        # Reusable components
│   │   ├── lib/               # Utilities and stores
│   │   ├── providers/         # Context providers
│   │   ├── styles/            # Global styles
│   │   └── types/             # TypeScript types
│   ├── public/                # Static assets
│   └── package.json
│
├── server/                   # Node.js backend
│   ├── src/
│   │   ├── routes/            # API endpoints
│   │   ├── middleware/        # Express middleware
│   │   ├── services/          # Business logic
│   │   ├── utils/             # Helper functions
│   │   └── index.ts           # Server entry point
│   ├── prisma/               # Database schema
│   └── package.json
│
├── docker-compose.yml        # Development setup
├── README.md                 # This file
└── package.json              # Root package file
```

## 📈 Monetization Rules

ViewmaXX implements a creator-friendly monetization system:

### Eligibility Requirements
- ✅ Minimum 100 subscribers
- ✅ 50,000 total views with 3+ minutes watch time in last 30 days
- ✅ Account in good standing
- ✅ Original content compliance

### Revenue Sharing
- **Creators**: 70% of ad revenue
- **Platform**: 30% platform fee
- **Payment**: Monthly via PayPal, Stripe, or bank transfer
- **Minimum Payout**: $100

## 🔒 Security Features

- **Authentication**: JWT with refresh tokens
- **Authorization**: Role-based access control
- **Rate Limiting**: API endpoint protection
- **Input Validation**: Zod schema validation
- **File Upload**: Secure S3 presigned URLs
- **Content Security**: XSS and CSRF protection
- **Data Encryption**: Sensitive data encryption

## 📦 Deployment

### Production Environment

1. **Build Applications**
   ```bash
   # Build frontend
   cd client
   npm run build
   
   # Build backend
   cd ../server
   npm run build
   ```

2. **Database Migration**
   ```bash
   npx prisma migrate deploy
   ```

3. **Start Production Servers**
   ```bash
   # Start backend
   npm start
   
   # Start frontend (or use Vercel/Netlify)
   npm start
   ```

### Docker Production

```bash
# Build and start production containers
docker-compose -f docker-compose.prod.yml up -d
```

## 📊 Analytics & Monitoring

- **Video Analytics**: Views, watch time, engagement metrics
- **Channel Analytics**: Subscriber growth, revenue tracking
- **Platform Analytics**: User growth, content trends
- **Real-time Monitoring**: System health and performance
- **Error Tracking**: Comprehensive error logging

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow TypeScript best practices
- Write comprehensive tests
- Document API changes
- Follow commit message conventions
- Ensure responsive design

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📞 Support

- **Documentation**: [docs.viewmaxx.com](https://docs.viewmaxx.com)
- **Community**: [Discord Server](https://discord.gg/viewmaxx)
- **Issues**: [GitHub Issues](https://github.com/your-org/viewmaxx/issues)
- **Email**: support@viewmaxx.com

## 🗣️ Roadmap

- [ ] Mobile applications (iOS/Android)
- [ ] Advanced AI recommendations
- [ ] Live streaming improvements
- [ ] Multi-language support
- [ ] Advanced analytics dashboard
- [ ] Creator collaboration tools
- [ ] NFT and Web3 integration
- [ ] Advanced content moderation

---

**Built with ❤️ by [MiniMax Agent](https://github.com/minimax-agent)**

*ViewmaXX - Empowering creators, engaging audiences*

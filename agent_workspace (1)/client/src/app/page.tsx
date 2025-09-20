import { VideoGrid } from '@/components/video/VideoGrid';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';

// Mock data - in real app, this would come from API
const mockVideos = [
  {
    id: '1',
    title: 'Getting Started with Next.js 14',
    description: 'Learn the basics of Next.js 14 with App Router',
    videoUrl: '/videos/sample1.mp4',
    thumbnail: 'https://picsum.photos/320/180?random=1',
    duration: 720, // 12 minutes
    views: 15420,
    likes: 892,
    dislikes: 23,
    tags: ['nextjs', 'react', 'tutorial'],
    category: 'Education',
    visibility: 'public' as const,
    status: 'published' as const,
    quality: [],
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    channelId: 'channel1',
    channel: {
      id: 'channel1',
      name: 'Tech Tutorials',
      username: 'techtutor',
      avatar: 'https://picsum.photos/40/40?random=101',
      isVerified: true,
    },
    userId: 'user1',
  },
  {
    id: '2',
    title: 'Advanced React Patterns',
    description: 'Deep dive into advanced React patterns and best practices',
    videoUrl: '/videos/sample2.mp4',
    thumbnail: 'https://picsum.photos/320/180?random=2',
    duration: 1440, // 24 minutes
    views: 8934,
    likes: 567,
    dislikes: 12,
    tags: ['react', 'patterns', 'advanced'],
    category: 'Education',
    visibility: 'public' as const,
    status: 'published' as const,
    quality: [],
    createdAt: '2025-01-14T14:30:00Z',
    updatedAt: '2025-01-14T14:30:00Z',
    channelId: 'channel2',
    channel: {
      id: 'channel2',
      name: 'React Mastery',
      username: 'reactmaster',
      avatar: 'https://picsum.photos/40/40?random=102',
      isVerified: false,
    },
    userId: 'user2',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />
      
      <div className="flex">
        <Sidebar />
        
        <main className="flex-1 ml-64 p-6">
          <div className="max-w-7xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Recommended for you
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                Discover trending videos and content from creators you love
              </p>
            </div>
            
            <VideoGrid videos={mockVideos} />
          </div>
        </main>
      </div>
    </div>
  );
}

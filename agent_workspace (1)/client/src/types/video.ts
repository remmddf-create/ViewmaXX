export interface Video {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
  thumbnail: string;
  duration: number;
  views: number;
  likes: number;
  dislikes: number;
  tags: string[];
  category: string;
  visibility: 'public' | 'unlisted' | 'private';
  status: 'uploading' | 'processing' | 'published' | 'failed';
  quality: VideoQuality[];
  captions?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  channelId: string;
  channel: {
    id: string;
    name: string;
    username: string;
    avatar: string;
    isVerified: boolean;
  };
  userId: string;
}

export interface VideoQuality {
  resolution: string;
  url: string;
  bitrate: number;
  format: string;
}

export interface Comment {
  id: string;
  content: string;
  likes: number;
  dislikes: number;
  replies: Comment[];
  replyCount: number;
  createdAt: string;
  updatedAt: string;
  videoId: string;
  userId: string;
  user: {
    id: string;
    username: string;
    avatar: string;
    isVerified: boolean;
  };
  parentId?: string;
}

export interface Playlist {
  id: string;
  title: string;
  description?: string;
  thumbnail?: string;
  visibility: 'public' | 'unlisted' | 'private';
  videoCount: number;
  totalDuration: number;
  createdAt: string;
  updatedAt: string;
  userId: string;
  videos: PlaylistVideo[];
}

export interface PlaylistVideo {
  id: string;
  position: number;
  addedAt: string;
  playlistId: string;
  videoId: string;
  video: Video;
}

export interface VideoUpload {
  id: string;
  filename: string;
  originalName: string;
  size: number;
  mimetype: string;
  uploadProgress: number;
  processingProgress: number;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  userId: string;
}

export interface VideoAnalytics {
  videoId: string;
  views: number;
  uniqueViews: number;
  watchTime: number;
  averageWatchTime: number;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
  clickThroughRate: number;
  retentionRate: number;
  revenue?: number;
  date: string;
}

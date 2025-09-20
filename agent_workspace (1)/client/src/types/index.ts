// User & Authentication Types
export interface User {
  id: string;
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  coverImage?: string;
  isVerified: boolean;
  role: 'USER' | 'CREATOR' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN';
  createdAt: string;
  updatedAt: string;
}

export interface Channel {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  banner?: string;
  isVerified: boolean;
  isActive: boolean;
  userId: string;
  user?: User;
  subscriberCount?: number;
  videoCount?: number;
  createdAt: string;
  updatedAt: string;
}

// Video Types
export interface Video {
  id: string;
  title: string;
  description?: string;
  thumbnail?: string;
  duration?: number;
  views: number;
  likes: number;
  dislikes: number;
  status: 'UPLOADING' | 'PROCESSING' | 'PUBLISHED' | 'UNLISTED' | 'PRIVATE' | 'DELETED' | 'FAILED';
  privacy: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  category?: string;
  tags: string[];
  language: string;
  slug: string;
  metaTitle?: string;
  metaDesc?: string;
  monetized: boolean;
  adsEnabled: boolean;
  revenue: number;
  originalFile?: string;
  processedFiles?: Record<string, string>;
  hlsPlaylist?: string;
  dashPlaylist?: string;
  userId: string;
  channelId: string;
  user?: User;
  channel?: Channel;
  createdAt: string;
  updatedAt: string;
  userLikeStatus?: 'LIKE' | 'DISLIKE' | null;
  isSubscribed?: boolean;
  _count?: {
    comments: number;
    likes: number;
  };
}

// Comment Types
export interface Comment {
  id: string;
  content: string;
  likes: number;
  userId: string;
  videoId: string;
  parentId?: string;
  user: {
    id: string;
    username: string;
    avatar?: string;
    isVerified: boolean;
  };
  replies?: Comment[];
  createdAt: string;
  updatedAt: string;
  _count?: {
    replies: number;
  };
}

// Subscription Types
export interface Subscription {
  id: string;
  userId: string;
  channelId: string;
  channel: Channel;
  createdAt: string;
}

// Playlist Types
export interface Playlist {
  id: string;
  name: string;
  description?: string;
  thumbnail?: string;
  privacy: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  status: 'ACTIVE' | 'DELETED';
  userId: string;
  channelId: string;
  user?: User;
  channel?: Channel;
  items?: PlaylistItem[];
  createdAt: string;
  updatedAt: string;
  _count?: {
    items: number;
  };
}

export interface PlaylistItem {
  id: string;
  position: number;
  playlistId: string;
  videoId: string;
  video: Video;
  createdAt: string;
}

// Live Stream Types
export interface LiveStream {
  id: string;
  title: string;
  description?: string;
  thumbnail?: string;
  status: 'OFFLINE' | 'STARTING' | 'LIVE' | 'ENDING' | 'ENDED';
  streamKey: string;
  viewers: number;
  maxViewers: number;
  chatEnabled: boolean;
  privacy: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  userId: string;
  channelId: string;
  user?: User;
  channel?: Channel;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface ChatMessage {
  id: string;
  message: string;
  userId: string;
  liveStreamId: string;
  user: {
    id: string;
    username: string;
    avatar?: string;
    isVerified: boolean;
  };
  createdAt: string;
}

// Monetization Types
export interface Monetization {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  applicationDate: string;
  approvalDate?: string;
  rejectionReason?: string;
  totalEarnings: number;
  availableBalance: number;
  lifetimeEarnings: number;
  revenueShare: number;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
  method: 'STRIPE' | 'PAYPAL' | 'CRYPTO' | 'BANK_TRANSFER';
  stripeId?: string;
  paypalId?: string;
  cryptoAddress?: string;
  cryptoTxHash?: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

// Notification Types
export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'VIDEO_UPLOAD' | 'COMMENT' | 'LIKE' | 'SUBSCRIPTION' | 'MONETIZATION' | 'PAYMENT' | 'SYSTEM';
  isRead: boolean;
  data?: any;
  userId: string;
  createdAt: string;
}

// Analytics Types
export interface VideoAnalytics {
  id: string;
  date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchTime: number;
  averageViewDuration: number;
  revenue: number;
  impressions: number;
  clickThroughRate: number;
  videoId: string;
}

export interface UserAnalytics {
  id: string;
  date: string;
  totalViews: number;
  watchTime: number;
  newSubscribers: number;
  revenue: number;
  userId: string;
}

export interface ChannelAnalytics {
  id: string;
  date: string;
  views: number;
  subscribers: number;
  videosUploaded: number;
  watchTime: number;
  revenue: number;
  channelId: string;
}

// API Response Types
export interface PaginatedResponse<T> {
  data?: T[];
  videos?: T[];
  channels?: T[];
  users?: T[];
  notifications?: T[];
  playlists?: T[];
  streams?: T[];
  comments?: T[];
  subscriptions?: T[];
  payments?: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface ApiResponse<T = any> {
  success?: boolean;
  message?: string;
  data?: T;
  error?: string;
  errors?: Array<{
    field: string;
    message: string;
  }>;
}

// Search Types
export interface SearchFilters {
  type?: 'all' | 'videos' | 'channels' | 'users';
  category?: string;
  duration?: 'short' | 'medium' | 'long';
  uploadDate?: 'hour' | 'today' | 'week' | 'month' | 'year';
  sort?: 'relevance' | 'date' | 'views' | 'rating';
}

export interface SearchResults {
  query: string;
  type: string;
  videos: {
    items: Video[];
    total: number;
  };
  channels: {
    items: Channel[];
    total: number;
  };
  users: {
    items: User[];
    total: number;
  };
  pagination: {
    page: number;
    limit: number;
    hasMore: {
      videos: boolean;
      channels: boolean;
      users: boolean;
    };
  };
}

// Upload Types
export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface VideoUploadData {
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  privacy?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  language?: string;
  file: File;
  thumbnail?: File;
}

// Form Types
export interface LoginFormData {
  email: string;
  password: string;
}

export interface RegisterFormData {
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
  firstName?: string;
  lastName?: string;
}

export interface VideoFormData {
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  privacy: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  language: string;
}

export interface ChannelFormData {
  name: string;
  description?: string;
}

export interface PlaylistFormData {
  name: string;
  description?: string;
  privacy: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
}

export interface LiveStreamFormData {
  title: string;
  description?: string;
  privacy: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  chatEnabled: boolean;
}

// UI Component Types
export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
}

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export interface TabItem {
  id: string;
  label: string;
  content: React.ReactNode;
  disabled?: boolean;
}

// Video Player Types
export interface VideoPlayerProps {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  controls?: boolean;
  muted?: boolean;
  loop?: boolean;
  onTimeUpdate?: (currentTime: number) => void;
  onEnded?: () => void;
  onError?: (error: any) => void;
  className?: string;
}

export interface VideoQuality {
  label: string;
  value: string;
  url: string;
}

export interface VideoPlayerState {
  playing: boolean;
  muted: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  buffered: number;
  fullscreen: boolean;
  quality: string;
  playbackRate: number;
}

// Theme Types
export type Theme = 'light' | 'dark' | 'system';

// Error Types
export interface ApiError {
  message: string;
  status: number;
  code?: string;
}

export interface FormError {
  field: string;
  message: string;
}

// Utility Types
export type Nullable<T> = T | null;
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

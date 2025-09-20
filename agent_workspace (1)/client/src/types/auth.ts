export interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  avatar?: string;
  bio?: string;
  isVerified: boolean;
  subscriberCount: number;
  totalViews: number;
  totalVideos: number;
  createdAt: string;
  updatedAt: string;
  channelId: string;
  isMonetized: boolean;
  monetizationAppliedAt?: string;
  monetizationApprovedAt?: string;
}

export interface Channel {
  id: string;
  name: string;
  username: string;
  description?: string;
  avatar: string;
  banner?: string;
  subscriberCount: number;
  videoCount: number;
  totalViews: number;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
  userId: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignupData {
  email: string;
  password: string;
  username: string;
  firstName: string;
  lastName: string;
}

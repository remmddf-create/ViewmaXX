import { create } from 'zustand';
import { Video } from '@/types/video';

interface VideoStore {
  videos: Video[];
  currentVideo: Video | null;
  loading: boolean;
  error: string | null;
  
  // Actions
  fetchVideos: (params?: {
    page?: number;
    limit?: number;
    category?: string;
    search?: string;
    sort?: 'newest' | 'oldest' | 'popular' | 'trending';
  }) => Promise<void>;
  fetchVideoById: (id: string) => Promise<void>;
  likeVideo: (videoId: string) => Promise<void>;
  dislikeVideo: (videoId: string) => Promise<void>;
  viewVideo: (videoId: string) => Promise<void>;
  setCurrentVideo: (video: Video | null) => void;
  clearError: () => void;
}

export const useVideoStore = create<VideoStore>((set, get) => ({
  videos: [],
  currentVideo: null,
  loading: false,
  error: null,

  fetchVideos: async (params = {}) => {
    set({ loading: true, error: null });
    try {
      const queryParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });

      const response = await fetch(`/api/videos?${queryParams.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch videos');
      }

      const data = await response.json();
      set({ videos: data.videos, loading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to fetch videos', 
        loading: false 
      });
    }
  },

  fetchVideoById: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`/api/videos/${id}`);
      if (!response.ok) {
        throw new Error('Video not found');
      }

      const video = await response.json();
      set({ currentVideo: video, loading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to fetch video', 
        loading: false 
      });
    }
  },

  likeVideo: async (videoId: string) => {
    try {
      const response = await fetch(`/api/videos/${videoId}/like`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to like video');
      }

      const updatedVideo = await response.json();
      const { videos, currentVideo } = get();
      
      set({
        videos: videos.map(v => v.id === videoId ? updatedVideo : v),
        currentVideo: currentVideo?.id === videoId ? updatedVideo : currentVideo,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to like video' });
    }
  },

  dislikeVideo: async (videoId: string) => {
    try {
      const response = await fetch(`/api/videos/${videoId}/dislike`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to dislike video');
      }

      const updatedVideo = await response.json();
      const { videos, currentVideo } = get();
      
      set({
        videos: videos.map(v => v.id === videoId ? updatedVideo : v),
        currentVideo: currentVideo?.id === videoId ? updatedVideo : currentVideo,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to dislike video' });
    }
  },

  viewVideo: async (videoId: string) => {
    try {
      await fetch(`/api/videos/${videoId}/view`, {
        method: 'POST',
      });
    } catch (error) {
      // Silently fail for view tracking
      console.error('Failed to track video view:', error);
    }
  },

  setCurrentVideo: (video: Video | null) => {
    set({ currentVideo: video });
  },

  clearError: () => {
    set({ error: null });
  },
}));

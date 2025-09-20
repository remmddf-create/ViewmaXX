import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import Cookies from 'js-cookie';
import toast from 'react-hot-toast';

// Create axios instance
export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL + '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    // Add auth token if available
    const token = Cookies.get('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    // Handle 401 errors (unauthorized)
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Try to refresh token
        const refreshToken = Cookies.get('refreshToken');
        if (refreshToken) {
          const response = await axios.post(
            `${process.env.NEXT_PUBLIC_API_URL}/api/auth/refresh`,
            { refreshToken }
          );

          const { accessToken, refreshToken: newRefreshToken } = response.data.tokens;
          
          // Update tokens
          Cookies.set('token', accessToken, { expires: 7 });
          Cookies.set('refreshToken', newRefreshToken, { expires: 30 });
          
          // Retry original request
          originalRequest.headers!.Authorization = `Bearer ${accessToken}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        // Refresh failed, redirect to login
        console.error('Token refresh failed:', refreshError);
        
        // Clear tokens
        Cookies.remove('token');
        Cookies.remove('refreshToken');
        localStorage.removeItem('user');
        
        // Redirect to login if not already there
        if (!window.location.pathname.includes('/auth')) {
          window.location.href = '/auth/login';
        }
        
        return Promise.reject(refreshError);
      }
    }

    // Handle other errors
    if (error.response?.status >= 500) {
      toast.error('Server error. Please try again later.');
    } else if (error.response?.status === 404) {
      toast.error('Resource not found.');
    } else if (error.response?.status === 403) {
      toast.error('Access denied.');
    }

    return Promise.reject(error);
  }
);

// File upload helper
export const uploadFile = async (
  url: string,
  file: File,
  onProgress?: (progress: { loaded: number; total: number; percentage: number }) => void
) => {
  const formData = new FormData();
  formData.append('file', file);

  return api.post(url, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const percentage = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress({
          loaded: progressEvent.loaded,
          total: progressEvent.total,
          percentage,
        });
      }
    },
  });
};

// Video upload helper
export const uploadVideo = async (
  file: File,
  metadata: {
    title: string;
    description?: string;
    category?: string;
    tags?: string[];
    privacy?: string;
    language?: string;
  },
  onProgress?: (progress: { loaded: number; total: number; percentage: number }) => void
) => {
  const formData = new FormData();
  formData.append('video', file);
  
  // Add metadata
  Object.entries(metadata).forEach(([key, value]) => {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        formData.append(key, JSON.stringify(value));
      } else {
        formData.append(key, value);
      }
    }
  });

  return api.post('/videos/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    timeout: 300000, // 5 minutes for video uploads
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const percentage = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress({
          loaded: progressEvent.loaded,
          total: progressEvent.total,
          percentage,
        });
      }
    },
  });
};

// Helper functions for common API calls
export const authApi = {
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  register: (data: any) => api.post('/auth/register', data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  refreshToken: (refreshToken: string) => api.post('/auth/refresh', { refreshToken }),
};

export const videosApi = {
  getVideos: (params?: any) => api.get('/videos', { params }),
  getVideo: (id: string) => api.get(`/videos/${id}`),
  getTrending: (limit?: number) => api.get('/videos/trending', { params: { limit } }),
  uploadVideo: (formData: FormData, onProgress?: any) => 
    api.post('/videos/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress,
    }),
  updateVideo: (id: string, data: any) => api.put(`/videos/${id}`, data),
  deleteVideo: (id: string) => api.delete(`/videos/${id}`),
  likeVideo: (id: string) => api.post(`/videos/${id}/like`),
  uploadThumbnail: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('thumbnail', file);
    return api.post(`/videos/${id}/thumbnail`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const channelsApi = {
  getChannel: (id: string) => api.get(`/channels/${id}`),
  updateChannel: (id: string, data: any) => api.put(`/channels/${id}`, data),
  getChannelVideos: (id: string, params?: any) => api.get(`/channels/${id}/videos`, { params }),
  getChannelPlaylists: (id: string, params?: any) => api.get(`/channels/${id}/playlists`, { params }),
  uploadAvatar: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return api.post(`/channels/${id}/avatar`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  uploadBanner: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('banner', file);
    return api.post(`/channels/${id}/banner`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const usersApi = {
  getUser: (id: string) => api.get(`/users/${id}`),
  updateProfile: (data: any) => api.put('/users/profile', data),
  uploadAvatar: (file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return api.post('/users/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  uploadCover: (file: File) => {
    const formData = new FormData();
    formData.append('cover', file);
    return api.post('/users/cover', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  changePassword: (currentPassword: string, newPassword: string) => 
    api.put('/users/password', { currentPassword, newPassword }),
  deleteAccount: () => api.delete('/users/account'),
};

export const commentsApi = {
  getComments: (videoId: string, params?: any) => api.get(`/comments/video/${videoId}`, { params }),
  getReplies: (commentId: string, params?: any) => api.get(`/comments/${commentId}/replies`, { params }),
  createComment: (data: any) => api.post('/comments', data),
  updateComment: (id: string, content: string) => api.put(`/comments/${id}`, { content }),
  deleteComment: (id: string) => api.delete(`/comments/${id}`),
  likeComment: (id: string) => api.post(`/comments/${id}/like`),
};

export const subscriptionsApi = {
  subscribe: (channelId: string) => api.post('/subscriptions/subscribe', { channelId }),
  unsubscribe: (channelId: string) => api.post('/subscriptions/unsubscribe', { channelId }),
  getSubscriptions: (params?: any) => api.get('/subscriptions', { params }),
  getFeed: (params?: any) => api.get('/subscriptions/feed', { params }),
  checkSubscription: (channelId: string) => api.get(`/subscriptions/check/${channelId}`),
};

export const playlistsApi = {
  getPlaylists: (params?: any) => api.get('/playlists', { params }),
  getPlaylist: (id: string) => api.get(`/playlists/${id}`),
  createPlaylist: (data: any) => api.post('/playlists', data),
  updatePlaylist: (id: string, data: any) => api.put(`/playlists/${id}`, data),
  deletePlaylist: (id: string) => api.delete(`/playlists/${id}`),
  addVideo: (id: string, videoId: string) => api.post(`/playlists/${id}/videos`, { videoId }),
  removeVideo: (id: string, videoId: string) => api.delete(`/playlists/${id}/videos/${videoId}`),
  reorderItems: (id: string, items: any[]) => api.put(`/playlists/${id}/reorder`, { items }),
};

export const liveStreamsApi = {
  getStreams: (params?: any) => api.get('/live/streams', { params }),
  getStream: (id: string) => api.get(`/live/streams/${id}`),
  createStream: (data: any) => api.post('/live/streams', data),
  updateStream: (id: string, data: any) => api.put(`/live/streams/${id}`, data),
  startStream: (id: string) => api.post(`/live/streams/${id}/start`),
  stopStream: (id: string) => api.post(`/live/streams/${id}/stop`),
  deleteStream: (id: string) => api.delete(`/live/streams/${id}`),
  joinStream: (id: string) => api.post(`/live/streams/${id}/join`),
  leaveStream: (id: string) => api.post(`/live/streams/${id}/leave`),
  getChat: (id: string, params?: any) => api.get(`/live/streams/${id}/chat`, { params }),
  uploadThumbnail: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('thumbnail', file);
    return api.post(`/live/streams/${id}/thumbnail`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const searchApi = {
  search: (query: string, params?: any) => api.get('/search', { params: { q: query, ...params } }),
  getSuggestions: (query: string, limit?: number) => 
    api.get('/search/suggestions', { params: { q: query, limit } }),
  getTrending: () => api.get('/search/trending'),
};

export const notificationsApi = {
  getNotifications: (params?: any) => api.get('/notifications', { params }),
  getUnreadCount: () => api.get('/notifications/unread-count'),
  markAsRead: (id: string) => api.put(`/notifications/${id}/read`),
  markAllAsRead: () => api.put('/notifications/read-all'),
  deleteNotification: (id: string) => api.delete(`/notifications/${id}`),
  deleteAll: () => api.delete('/notifications'),
};

export const monetizationApi = {
  apply: () => api.post('/monetization/apply'),
  getStatus: () => api.get('/monetization/status'),
  getAnalytics: (params?: any) => api.get('/monetization/analytics', { params }),
  requestPayout: (amount: number, method: string) => 
    api.post('/monetization/payout', { amount, method }),
  getPayments: (params?: any) => api.get('/monetization/payments', { params }),
};

export const analyticsApi = {
  getOverview: (params?: any) => api.get('/analytics/overview', { params }),
  getVideoAnalytics: (videoId: string, params?: any) => 
    api.get(`/analytics/videos/${videoId}`, { params }),
  getAudience: (params?: any) => api.get('/analytics/audience', { params }),
  getRevenue: (params?: any) => api.get('/analytics/revenue', { params }),
  trackView: (videoId: string, watchTime: number, completed: boolean) => 
    api.post('/analytics/track-view', { videoId, watchTime, completed }),
};

export default api;

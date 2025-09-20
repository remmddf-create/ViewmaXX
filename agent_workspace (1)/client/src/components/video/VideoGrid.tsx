'use client';
import React from 'react';
import { VideoCard } from './VideoCard';
import { Video } from '@/types/video';

interface VideoGridProps {
  videos: Video[];
  loading?: boolean;
  columns?: number;
}

export function VideoGrid({ videos, loading = false, columns = 4 }: VideoGridProps) {
  if (loading) {
    return (
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-${columns} gap-6`}>
        {Array.from({ length: 12 }).map((_, index) => (
          <div key={index} className="bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden animate-pulse">
            <div className="h-40 bg-gray-300 dark:bg-gray-600"></div>
            <div className="p-3 space-y-2">
              <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded"></div>
              <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-3/4"></div>
              <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          No videos found
        </h3>
        <p className="text-gray-600 dark:text-gray-400">
          Try adjusting your search criteria or check back later for new content.
        </p>
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-${columns} gap-6`}>
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} />
      ))}
    </div>
  );
}

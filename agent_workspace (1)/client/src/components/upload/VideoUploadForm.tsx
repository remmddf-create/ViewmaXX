'use client';
import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Upload, X, Video, Image, AlertCircle } from 'lucide-react';

interface VideoUploadData {
  title: string;
  description: string;
  tags: string[];
  category: string;
  visibility: 'public' | 'unlisted' | 'private';
  thumbnail?: File;
  video?: File;
}

const CATEGORIES = [
  'Entertainment',
  'Music',
  'Gaming',
  'Education',
  'Science & Technology',
  'Sports',
  'News & Politics',
  'Comedy',
  'Travel & Events',
  'Pets & Animals',
  'How-to & Style',
  'Film & Animation',
];

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
const ACCEPTED_VIDEO_TYPES = {
  'video/mp4': ['.mp4'],
  'video/quicktime': ['.mov'],
  'video/x-msvideo': ['.avi'],
  'video/x-ms-wmv': ['.wmv'],
  'video/x-matroska': ['.mkv'],
};

const ACCEPTED_IMAGE_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};

export function VideoUploadForm() {
  const [uploadData, setUploadData] = useState<VideoUploadData>({
    title: '',
    description: '',
    tags: [],
    category: '',
    visibility: 'public',
  });
  const [tagInput, setTagInput] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const onVideoDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        setError('File size must be less than 2GB');
        return;
      }
      setUploadData(prev => ({ ...prev, video: file }));
      setError('');
    }
  }, []);

  const onThumbnailDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      setUploadData(prev => ({ ...prev, thumbnail: file }));
    }
  }, []);

  const {
    getRootProps: getVideoRootProps,
    getInputProps: getVideoInputProps,
    isDragActive: isVideoDragActive,
  } = useDropzone({
    onDrop: onVideoDrop,
    accept: ACCEPTED_VIDEO_TYPES,
    multiple: false,
    maxSize: MAX_FILE_SIZE,
  });

  const {
    getRootProps: getThumbnailRootProps,
    getInputProps: getThumbnailInputProps,
    isDragActive: isThumbnailDragActive,
  } = useDropzone({
    onDrop: onThumbnailDrop,
    accept: ACCEPTED_IMAGE_TYPES,
    multiple: false,
    maxSize: 10 * 1024 * 1024, // 10MB
  });

  const handleInputChange = (field: keyof VideoUploadData, value: any) => {
    setUploadData(prev => ({ ...prev, [field]: value }));
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !uploadData.tags.includes(tagInput.trim()) && uploadData.tags.length < 10) {
      setUploadData(prev => ({
        ...prev,
        tags: [...prev.tags, tagInput.trim()],
      }));
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setUploadData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove),
    }));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadData.video) {
      setError('Please select a video file');
      return;
    }
    if (!uploadData.title.trim()) {
      setError('Please enter a title');
      return;
    }
    if (!uploadData.category) {
      setError('Please select a category');
      return;
    }

    setIsUploading(true);
    setError('');

    try {
      // Simulate upload progress
      for (let i = 0; i <= 100; i += 10) {
        setUploadProgress(i);
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Here you would make the actual API call to upload the video
      // const formData = new FormData();
      // formData.append('video', uploadData.video);
      // if (uploadData.thumbnail) formData.append('thumbnail', uploadData.thumbnail);
      // formData.append('title', uploadData.title);
      // formData.append('description', uploadData.description);
      // formData.append('category', uploadData.category);
      // formData.append('visibility', uploadData.visibility);
      // formData.append('tags', JSON.stringify(uploadData.tags));
      
      // const response = await fetch('/api/videos/upload', {
      //   method: 'POST',
      //   body: formData,
      // });

      setSuccess(true);
      setUploadProgress(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (success) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="pt-6">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto">
              <Video className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              Upload Successful!
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Your video has been uploaded and is being processed. You'll receive a notification when it's ready.
            </p>
            <Button onClick={() => window.location.reload()}>Upload Another Video</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Upload Video</CardTitle>
          <CardDescription>
            Share your content with the ViewmaXX community
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Video Upload */}
            <div className="space-y-2">
              <Label>Video File</Label>
              <div
                {...getVideoRootProps()}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                  isVideoDragActive
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-950'
                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                }`}
              >
                <input {...getVideoInputProps()} />
                {uploadData.video ? (
                  <div className="space-y-2">
                    <Video className="w-12 h-12 mx-auto text-blue-600" />
                    <p className="font-medium">{uploadData.video.name}</p>
                    <p className="text-sm text-gray-500">
                      {formatFileSize(uploadData.video.size)}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setUploadData(prev => ({ ...prev, video: undefined }));
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="w-12 h-12 mx-auto text-gray-400" />
                    <p className="text-lg font-medium">
                      {isVideoDragActive ? 'Drop video here' : 'Click or drag video to upload'}
                    </p>
                    <p className="text-sm text-gray-500">
                      Supports MP4, MOV, AVI, WMV, MKV (max 2GB)
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Thumbnail Upload */}
            <div className="space-y-2">
              <Label>Thumbnail (Optional)</Label>
              <div
                {...getThumbnailRootProps()}
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                  isThumbnailDragActive
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-950'
                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                }`}
              >
                <input {...getThumbnailInputProps()} />
                {uploadData.thumbnail ? (
                  <div className="flex items-center justify-center space-x-4">
                    <Image className="w-8 h-8 text-blue-600" />
                    <span className="font-medium">{uploadData.thumbnail.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setUploadData(prev => ({ ...prev, thumbnail: undefined }));
                      }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Image className="w-8 h-8 mx-auto text-gray-400" />
                    <p className="text-sm">
                      {isThumbnailDragActive ? 'Drop image here' : 'Click or drag thumbnail'}
                    </p>
                    <p className="text-xs text-gray-500">JPG, PNG, WebP (max 10MB)</p>
                  </div>
                )}
              </div>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="Enter video title"
                value={uploadData.title}
                onChange={(e) => handleInputChange('title', e.target.value)}
                maxLength={100}
                required
              />
              <p className="text-xs text-gray-500">
                {uploadData.title.length}/100 characters
              </p>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Tell viewers about your video"
                value={uploadData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={4}
                maxLength={1000}
              />
              <p className="text-xs text-gray-500">
                {uploadData.description.length}/1000 characters
              </p>
            </div>

            {/* Category */}
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={uploadData.category} onValueChange={(value) => handleInputChange('category', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex space-x-2">
                <Input
                  placeholder="Add a tag"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  disabled={uploadData.tags.length >= 10}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAddTag}
                  disabled={!tagInput.trim() || uploadData.tags.length >= 10}
                >
                  Add
                </Button>
              </div>
              {uploadData.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {uploadData.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="flex items-center space-x-1">
                      <span>{tag}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto p-0 ml-1"
                        onClick={() => handleRemoveTag(tag)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-500">
                {uploadData.tags.length}/10 tags
              </p>
            </div>

            {/* Visibility */}
            <div className="space-y-2">
              <Label>Visibility</Label>
              <Select value={uploadData.visibility} onValueChange={(value: any) => handleInputChange('visibility', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public - Anyone can view</SelectItem>
                  <SelectItem value="unlisted">Unlisted - Only people with the link</SelectItem>
                  <SelectItem value="private">Private - Only you can view</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Upload Progress */}
            {isUploading && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Uploading...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="w-full" />
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full"
              disabled={isUploading || !uploadData.video || !uploadData.title.trim()}
            >
              {isUploading ? 'Uploading...' : 'Upload Video'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

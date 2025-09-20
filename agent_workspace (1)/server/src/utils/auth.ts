import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { User } from '@prisma/client';

// JWT Token utilities
export const generateTokens = (userId: string) => {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET!,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  return { accessToken, refreshToken };
};

export const verifyAccessToken = (token: string): { userId: string } | null => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
  } catch (error) {
    return null;
  }
};

export const verifyRefreshToken = (token: string): { userId: string } | null => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as { userId: string };
  } catch (error) {
    return null;
  }
};

// Password utilities
export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '12');
  return bcrypt.hash(password, saltRounds);
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

// Validation utilities
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validatePassword = (password: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
};

export const validateUsername = (username: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (username.length < 3) {
    errors.push('Username must be at least 3 characters long');
  }
  
  if (username.length > 30) {
    errors.push('Username must be no more than 30 characters long');
  }
  
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    errors.push('Username can only contain letters, numbers, underscores, and hyphens');
  }
  
  if (/^[0-9]/.test(username)) {
    errors.push('Username cannot start with a number');
  }
  
  // Reserved usernames
  const reserved = [
    'admin', 'administrator', 'root', 'support', 'help', 'api', 'www',
    'mail', 'email', 'system', 'user', 'test', 'guest', 'anonymous',
    'null', 'undefined', 'viewmaxx', 'youtube', 'twitch', 'tiktok'
  ];
  
  if (reserved.includes(username.toLowerCase())) {
    errors.push('This username is reserved and cannot be used');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
};

// Generate secure random tokens
export const generateRandomToken = (length: number = 32): string => {
  return crypto.randomBytes(length).toString('hex');
};

// Generate verification codes
export const generateVerificationCode = (length: number = 6): string => {
  const digits = '0123456789';
  let code = '';
  
  for (let i = 0; i < length; i++) {
    code += digits[Math.floor(Math.random() * digits.length)];
  }
  
  return code;
};

// Session utilities
export const generateSessionId = (): string => {
  return crypto.randomUUID();
};

// API Key utilities
export const generateApiKey = (): string => {
  const prefix = 'vmax_';
  const key = crypto.randomBytes(32).toString('hex');
  return prefix + key;
};

export const validateApiKey = (apiKey: string): boolean => {
  return apiKey.startsWith('vmax_') && apiKey.length === 69; // 5 + 64
};

// Rate limiting helpers
export const generateRateLimitKey = (identifier: string, action: string): string => {
  return `rate_limit:${action}:${identifier}`;
};

// Two-Factor Authentication utilities
export const generateTOTPSecret = (): string => {
  return crypto.randomBytes(16).toString('base32');
};

// Device fingerprinting
export const generateDeviceFingerprint = (req: any): string => {
  const userAgent = req.headers['user-agent'] || '';
  const acceptLanguage = req.headers['accept-language'] || '';
  const acceptEncoding = req.headers['accept-encoding'] || '';
  const ip = req.ip || '';
  
  const fingerprint = `${userAgent}:${acceptLanguage}:${acceptEncoding}:${ip}`;
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
};

// Permission utilities
export const hasPermission = (user: User, permission: string): boolean => {
  // Implement role-based permission checking
  if (user.isAdmin) {
    return true; // Admins have all permissions
  }
  
  // Define user permissions based on status
  const userPermissions = [
    'upload_video',
    'comment',
    'like',
    'subscribe',
    'create_playlist',
  ];
  
  if (user.isVerified) {
    userPermissions.push(
      'live_stream',
      'custom_thumbnail',
      'longer_videos'
    );
  }
  
  if (user.isMonetized) {
    userPermissions.push(
      'monetize_content',
      'view_analytics',
      'receive_payments'
    );
  }
  
  return userPermissions.includes(permission);
};

// Content moderation utilities
export const sanitizeContent = (content: string): string => {
  // Remove potentially harmful content
  return content
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
};

// URL validation
export const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// File type validation
export const isValidVideoType = (mimetype: string): boolean => {
  const allowedTypes = [
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-ms-wmv',
    'video/x-matroska',
    'video/webm'
  ];
  return allowedTypes.includes(mimetype);
};

export const isValidImageType = (mimetype: string): boolean => {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ];
  return allowedTypes.includes(mimetype);
};

// Text processing utilities
export const extractHashtags = (text: string): string[] => {
  const hashtagRegex = /#[a-zA-Z0-9_]+/g;
  const matches = text.match(hashtagRegex);
  return matches ? matches.map(tag => tag.substring(1).toLowerCase()) : [];
};

export const extractMentions = (text: string): string[] => {
  const mentionRegex = /@[a-zA-Z0-9_]+/g;
  const matches = text.match(mentionRegex);
  return matches ? matches.map(mention => mention.substring(1).toLowerCase()) : [];
};

// Time utilities
export const isWithinTimeWindow = (timestamp: Date, windowMinutes: number): boolean => {
  const now = new Date();
  const diffMinutes = (now.getTime() - timestamp.getTime()) / (1000 * 60);
  return diffMinutes <= windowMinutes;
};

// Encryption utilities for sensitive data
export const encrypt = (text: string): string => {
  const algorithm = 'aes-256-gcm';
  const secretKey = process.env.ENCRYPTION_SECRET || 'default-secret-key-change-me';
  const key = crypto.scryptSync(secretKey, 'salt', 32);
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipher(algorithm, key);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
};

export const decrypt = (encryptedText: string): string => {
  const algorithm = 'aes-256-gcm';
  const secretKey = process.env.ENCRYPTION_SECRET || 'default-secret-key-change-me';
  const key = crypto.scryptSync(secretKey, 'salt', 32);
  
  const [ivHex, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  
  const decipher = crypto.createDecipher(algorithm, key);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

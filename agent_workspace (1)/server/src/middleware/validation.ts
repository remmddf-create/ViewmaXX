import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';

export const validateRequest = (schema: z.ZodSchema, source: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      let data;
      switch (source) {
        case 'query':
          data = req.query;
          break;
        case 'params':
          data = req.params;
          break;
        default:
          data = req.body;
      }

      const validated = schema.parse(data);
      
      // Replace the original data with validated data
      switch (source) {
        case 'query':
          req.query = validated;
          break;
        case 'params':
          req.params = validated;
          break;
        default:
          req.body = validated;
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));

        return res.status(400).json({
          error: 'Validation failed',
          details: errors,
        });
      }
      
      return res.status(500).json({
        error: 'Internal server error',
      });
    }
  };
};

// Custom validation schemas
export const commonSchemas = {
  // Pagination
  pagination: z.object({
    page: z.string().optional().transform(val => val ? Math.max(1, parseInt(val)) : 1),
    limit: z.string().optional().transform(val => {
      const num = val ? parseInt(val) : 20;
      return Math.min(Math.max(1, num), 100); // Limit between 1 and 100
    }),
  }),

  // ID validation
  uuidParam: z.object({
    id: z.string().uuid('Invalid ID format'),
  }),

  // Search
  search: z.object({
    q: z.string().min(1).max(100).optional(),
    sort: z.enum(['newest', 'oldest', 'popular', 'relevance']).optional(),
    filter: z.string().optional(),
  }),

  // File upload
  fileUpload: z.object({
    filename: z.string().min(1).max(255),
    size: z.number().positive().max(2 * 1024 * 1024 * 1024), // 2GB
    mimetype: z.string().min(1),
  }),

  // User profile update
  userProfile: z.object({
    firstName: z.string().min(1).max(50).optional(),
    lastName: z.string().min(1).max(50).optional(),
    bio: z.string().max(500).optional(),
    website: z.string().url().optional(),
    location: z.string().max(100).optional(),
  }),

  // Video metadata
  videoMetadata: z.object({
    title: z.string().min(1).max(100),
    description: z.string().max(2000).optional(),
    category: z.string().min(1),
    tags: z.array(z.string().min(1).max(30)).max(10).optional(),
    visibility: z.enum(['public', 'unlisted', 'private']).default('public'),
    language: z.string().length(2).optional(), // ISO 2-letter code
    mature: z.boolean().default(false),
  }),

  // Comment
  comment: z.object({
    content: z.string().min(1).max(1000),
    parentId: z.string().uuid().optional(),
  }),

  // Playlist
  playlist: z.object({
    title: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    visibility: z.enum(['public', 'unlisted', 'private']).default('public'),
  }),

  // Report
  report: z.object({
    type: z.enum(['spam', 'harassment', 'copyright', 'inappropriate', 'misinformation', 'other']),
    reason: z.string().min(1).max(500),
    targetType: z.enum(['video', 'comment', 'user', 'playlist']),
    targetId: z.string().uuid(),
  }),

  // Live stream
  liveStream: z.object({
    title: z.string().min(1).max(100),
    description: z.string().max(1000).optional(),
    category: z.string().min(1),
    tags: z.array(z.string().min(1).max(30)).max(10).optional(),
    privacy: z.enum(['public', 'unlisted', 'private']).default('public'),
    chatEnabled: z.boolean().default(true),
    recordingEnabled: z.boolean().default(true),
  }),

  // Channel settings
  channelSettings: z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(1000).optional(),
    website: z.string().url().optional(),
    keywords: z.array(z.string().min(1).max(30)).max(10).optional(),
    defaultVideoPrivacy: z.enum(['public', 'unlisted', 'private']).optional(),
    allowComments: z.boolean().optional(),
    allowRatings: z.boolean().optional(),
  }),

  // Monetization application
  monetizationApp: z.object({
    paymentMethod: z.enum(['paypal', 'stripe', 'bank_transfer']),
    paymentDetails: z.object({
      email: z.string().email().optional(),
      accountNumber: z.string().optional(),
      routingNumber: z.string().optional(),
      accountHolderName: z.string().optional(),
    }),
    taxInfo: z.object({
      country: z.string().length(2),
      taxId: z.string().optional(),
      businessType: z.enum(['individual', 'business']).optional(),
    }),
    agreeToTerms: z.boolean().refine(val => val === true, {
      message: 'Must agree to terms and conditions',
    }),
  }),

  // Admin actions
  adminAction: z.object({
    action: z.enum(['suspend', 'unsuspend', 'verify', 'unverify', 'delete', 'approve', 'reject']),
    reason: z.string().min(1).max(500),
    duration: z.number().positive().optional(), // For temporary suspensions
  }),

  // Notification settings
  notificationSettings: z.object({
    emailNotifications: z.boolean().default(true),
    pushNotifications: z.boolean().default(true),
    smsNotifications: z.boolean().default(false),
    subscriptionNotifications: z.boolean().default(true),
    likeNotifications: z.boolean().default(true),
    commentNotifications: z.boolean().default(true),
    mentionNotifications: z.boolean().default(true),
    liveStreamNotifications: z.boolean().default(true),
  }),

  // Two-factor authentication
  twoFactorAuth: z.object({
    method: z.enum(['totp', 'sms', 'email']),
    code: z.string().length(6),
    backupCode: z.string().optional(),
  }),

  // API key
  apiKey: z.object({
    name: z.string().min(1).max(100),
    scopes: z.array(z.enum([
      'read:videos',
      'write:videos',
      'read:comments',
      'write:comments',
      'read:analytics',
      'read:profile',
      'write:profile',
    ])).min(1),
    expiresAt: z.string().datetime().optional(),
  }),
};

// Validation middleware factory for common patterns
export const validatePagination = () => validateRequest(commonSchemas.pagination, 'query');
export const validateUUID = () => validateRequest(commonSchemas.uuidParam, 'params');
export const validateSearch = () => validateRequest(commonSchemas.search, 'query');

// Custom validators
export const validateFileSize = (maxSize: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.file && req.file.size > maxSize) {
      return res.status(400).json({
        error: 'File too large',
        maxSize: maxSize,
        receivedSize: req.file.size,
      });
    }
    next();
  };
};

export const validateContentType = (allowedTypes: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentType = req.headers['content-type'];
    if (contentType && !allowedTypes.some(type => contentType.includes(type))) {
      return res.status(400).json({
        error: 'Invalid content type',
        allowed: allowedTypes,
        received: contentType,
      });
    }
    next();
  };
};

// Sanitization middleware
export const sanitizeInput = (fields: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    fields.forEach(field => {
      if (req.body[field] && typeof req.body[field] === 'string') {
        // Basic HTML sanitization
        req.body[field] = req.body[field]
          .replace(/<script[^>]*>.*?<\/script>/gi, '')
          .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+\s*=/gi, '')
          .trim();
      }
    });
    next();
  };
};

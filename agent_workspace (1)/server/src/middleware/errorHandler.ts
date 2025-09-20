import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

// Custom error classes
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  public readonly details: any;

  constructor(message: string, details?: any) {
    super(message, 400);
    this.details = details;
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied') {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource already exists') {
    super(message, 409);
  }
}

export class RateLimitError extends AppError {
  public readonly retryAfter: number;

  constructor(message: string = 'Too many requests', retryAfter: number = 60) {
    super(message, 429);
    this.retryAfter = retryAfter;
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service temporarily unavailable') {
    super(message, 503);
  }
}

// Error handler middleware
export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  let error = err;

  // Log error
  console.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    body: req.body,
    query: req.query,
    params: req.params,
  });

  // Handle different error types
  if (err instanceof ZodError) {
    error = new ValidationError('Validation failed', {
      fields: err.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
        code: e.code,
      }))
    });
  } else if (err instanceof JsonWebTokenError) {
    error = new AuthenticationError('Invalid token');
  } else if (err instanceof TokenExpiredError) {
    error = new AuthenticationError('Token expired');
  } else if (err instanceof PrismaClientKnownRequestError) {
    error = handlePrismaError(err);
  }

  // Handle specific HTTP errors
  if (err.message?.includes('ENOTFOUND') || err.message?.includes('ECONNREFUSED')) {
    error = new ServiceUnavailableError('External service unavailable');
  }

  // Handle file upload errors
  if (err.message?.includes('File too large')) {
    error = new ValidationError('File size exceeds limit');
  }

  if (err.message?.includes('Invalid file type')) {
    error = new ValidationError('Invalid file type');
  }

  // Default to 500 server error
  if (!(error instanceof AppError)) {
    error = new AppError(
      process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
      500,
      false
    );
  }

  // Send error response
  const appError = error as AppError;
  const response: any = {
    error: appError.message,
    status: appError.statusCode,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method,
  };

  // Add additional error details in development
  if (process.env.NODE_ENV === 'development') {
    response.stack = appError.stack;
    
    if (appError instanceof ValidationError && appError.details) {
      response.details = appError.details;
    }
  }

  // Add rate limit headers
  if (appError instanceof RateLimitError) {
    res.setHeader('Retry-After', appError.retryAfter);
    res.setHeader('X-RateLimit-Reset', Date.now() + (appError.retryAfter * 1000));
  }

  res.status(appError.statusCode).json(response);
};

// Handle Prisma errors
const handlePrismaError = (err: PrismaClientKnownRequestError): AppError => {
  switch (err.code) {
    case 'P2002':
      // Unique constraint violation
      const field = err.meta?.target as string[] || ['field'];
      return new ConflictError(`${field.join(', ')} already exists`);
    
    case 'P2014':
      // Required relation violation
      return new ValidationError('Invalid relation data');
    
    case 'P2003':
      // Foreign key constraint violation
      return new ValidationError('Referenced record does not exist');
    
    case 'P2025':
      // Record not found
      return new NotFoundError('Record');
    
    case 'P2016':
      // Query interpretation error
      return new ValidationError('Invalid query parameters');
    
    case 'P2021':
      // Table does not exist
      return new ServiceUnavailableError('Database schema error');
    
    case 'P1008':
      // Operation timeout
      return new ServiceUnavailableError('Database operation timeout');
    
    case 'P1002':
      // Database connection error
      return new ServiceUnavailableError('Database connection failed');
    
    default:
      return new AppError('Database error', 500, false);
  }
};

// Async error wrapper
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Not found handler
export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
  const error = new NotFoundError(`Route ${req.originalUrl}`);
  next(error);
};

// Global error handlers for uncaught exceptions
export const setupGlobalErrorHandlers = () => {
  // Handle uncaught exceptions
  process.on('uncaughtException', (err: Error) => {
    console.error('UNCAUGHT EXCEPTION! Shutting down...', err);
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err: Error) => {
    console.error('UNHANDLED REJECTION! Shutting down...', err);
    process.exit(1);
  });

  // Handle SIGTERM
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
  });

  // Handle SIGINT
  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
  });
};

// Error response helpers
export const sendErrorResponse = (res: Response, error: AppError) => {
  res.status(error.statusCode).json({
    error: error.message,
    status: error.statusCode,
    timestamp: new Date().toISOString(),
  });
};

export const sendValidationError = (res: Response, errors: any[]) => {
  res.status(400).json({
    error: 'Validation failed',
    details: errors,
    status: 400,
    timestamp: new Date().toISOString(),
  });
};

export const sendNotFoundError = (res: Response, resource: string = 'Resource') => {
  res.status(404).json({
    error: `${resource} not found`,
    status: 404,
    timestamp: new Date().toISOString(),
  });
};

export const sendUnauthorizedError = (res: Response, message: string = 'Access denied') => {
  res.status(401).json({
    error: message,
    status: 401,
    timestamp: new Date().toISOString(),
  });
};

export const sendForbiddenError = (res: Response, message: string = 'Forbidden') => {
  res.status(403).json({
    error: message,
    status: 403,
    timestamp: new Date().toISOString(),
  });
};

export const sendConflictError = (res: Response, message: string = 'Resource already exists') => {
  res.status(409).json({
    error: message,
    status: 409,
    timestamp: new Date().toISOString(),
  });
};

export const sendRateLimitError = (res: Response, retryAfter: number = 60) => {
  res.setHeader('Retry-After', retryAfter);
  res.setHeader('X-RateLimit-Reset', Date.now() + (retryAfter * 1000));
  
  res.status(429).json({
    error: 'Too many requests',
    status: 429,
    retryAfter,
    timestamp: new Date().toISOString(),
  });
};

export const sendServerError = (res: Response, message: string = 'Internal server error') => {
  res.status(500).json({
    error: message,
    status: 500,
    timestamp: new Date().toISOString(),
  });
};

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Request ID middleware for tracing
export const requestId = (req: Request, res: Response, next: NextFunction) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.headers['x-request-id'] = requestId as string;
  res.setHeader('X-Request-ID', requestId);
  next();
};

// Request logging middleware
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = req.headers['x-request-id'];
  
  // Log request start
  console.log(`[${new Date().toISOString()}] ${requestId} ${req.method} ${req.originalUrl} - START`);
  
  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any) {
    const duration = Date.now() - start;
    const size = res.get('content-length') || chunk?.length || 0;
    
    console.log(
      `[${new Date().toISOString()}] ${requestId} ${req.method} ${req.originalUrl} - ` +
      `${res.statusCode} ${duration}ms ${size}bytes`
    );
    
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
};

// Error logging middleware
export const errorLogger = (err: Error, req: Request, res: Response, next: NextFunction) => {
  const requestId = req.headers['x-request-id'];
  
  console.error(`[${new Date().toISOString()}] ${requestId} ERROR:`, {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    body: req.body,
    query: req.query,
    params: req.params,
    headers: req.headers,
  });
  
  next(err);
};

// Performance monitoring middleware
export const performanceMonitor = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime();
  
  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const duration = seconds * 1000 + nanoseconds / 1000000; // Convert to milliseconds
    
    // Log slow requests (> 1 second)
    if (duration > 1000) {
      console.warn(`SLOW REQUEST: ${req.method} ${req.originalUrl} - ${duration.toFixed(2)}ms`);
    }
    
    // Set performance header
    res.setHeader('X-Response-Time', `${duration.toFixed(2)}ms`);
  });
  
  next();
};

// Security headers middleware
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Remove potentially sensitive headers
  res.removeHeader('X-Powered-By');
  
  // Set security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  
  // Content Security Policy
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' https:",
    "connect-src 'self' https:",
    "media-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  
  res.setHeader('Content-Security-Policy', csp);
  
  next();
};

// IP extraction middleware
export const extractIP = (req: Request, res: Response, next: NextFunction) => {
  // Get real IP address from various headers
  const forwarded = req.headers['x-forwarded-for'];
  const realIP = req.headers['x-real-ip'];
  const cfConnectingIP = req.headers['cf-connecting-ip'];
  
  let clientIP = req.connection.remoteAddress || req.socket.remoteAddress;
  
  if (cfConnectingIP && typeof cfConnectingIP === 'string') {
    clientIP = cfConnectingIP;
  } else if (realIP && typeof realIP === 'string') {
    clientIP = realIP;
  } else if (forwarded && typeof forwarded === 'string') {
    clientIP = forwarded.split(',')[0].trim();
  }
  
  req.ip = clientIP;
  next();
};

// User agent parsing middleware
export const parseUserAgent = (req: Request, res: Response, next: NextFunction) => {
  const userAgent = req.headers['user-agent'] || '';
  
  // Simple user agent parsing
  const parsedUA = {
    browser: 'unknown',
    version: 'unknown',
    os: 'unknown',
    mobile: false,
  };
  
  // Detect mobile
  if (/Mobile|Android|iPhone|iPad/.test(userAgent)) {
    parsedUA.mobile = true;
  }
  
  // Detect browser
  if (userAgent.includes('Chrome')) {
    parsedUA.browser = 'Chrome';
  } else if (userAgent.includes('Firefox')) {
    parsedUA.browser = 'Firefox';
  } else if (userAgent.includes('Safari')) {
    parsedUA.browser = 'Safari';
  } else if (userAgent.includes('Edge')) {
    parsedUA.browser = 'Edge';
  }
  
  // Detect OS
  if (userAgent.includes('Windows')) {
    parsedUA.os = 'Windows';
  } else if (userAgent.includes('Mac')) {
    parsedUA.os = 'macOS';
  } else if (userAgent.includes('Linux')) {
    parsedUA.os = 'Linux';
  } else if (userAgent.includes('Android')) {
    parsedUA.os = 'Android';
  } else if (userAgent.includes('iOS')) {
    parsedUA.os = 'iOS';
  }
  
  (req as any).userAgent = parsedUA;
  next();
};

// Request size limiter
export const requestSizeLimit = (maxSize: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = req.headers['content-length'];
    
    if (contentLength && parseInt(contentLength) > maxSize) {
      return res.status(413).json({
        error: 'Request entity too large',
        maxSize,
        received: parseInt(contentLength),
      });
    }
    
    next();
  };
};

// API versioning middleware
export const apiVersion = (req: Request, res: Response, next: NextFunction) => {
  const version = req.headers['api-version'] || req.query.v || 'v1';
  (req as any).apiVersion = version;
  res.setHeader('API-Version', version as string);
  next();
};

// Request timeout middleware
export const requestTimeout = (timeoutMs: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          error: 'Request timeout',
          timeout: timeoutMs,
        });
      }
    }, timeoutMs);
    
    res.on('finish', () => {
      clearTimeout(timeout);
    });
    
    next();
  };
};

// Body parser error handler
export const bodyParserErrorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err.message.includes('JSON')) {
    return res.status(400).json({
      error: 'Invalid JSON in request body',
      details: err.message,
    });
  }
  
  if (err.message.includes('entity too large')) {
    return res.status(413).json({
      error: 'Request entity too large',
    });
  }
  
  next(err);
};

// CORS preflight handler
export const corsPreflightHandler = (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
    return res.status(200).end();
  }
  next();
};

import Redis from 'ioredis';

let redis: Redis;

export const initializeRedis = async () => {
  try {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: null,
      maxRetriesPerRequestAttempt: 3,
      lazyConnect: true,
    });

    // Test connection
    await redis.ping();
    console.log('✅ Redis connected successfully');

    // Set up error handling
    redis.on('error', (error) => {
      console.error('❌ Redis connection error:', error);
    });

    redis.on('connect', () => {
      console.log('🔄 Redis connected');
    });

    redis.on('disconnect', () => {
      console.log('🔌 Redis disconnected');
    });

    return redis;
  } catch (error) {
    console.error('❌ Failed to initialize Redis:', error);
    throw error;
  }
};

export { redis };

// Cache utilities
export const cache = {
  // Get cached data
  get: async <T>(key: string): Promise<T | null> => {
    try {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  },

  // Set cached data with expiration
  set: async (key: string, value: any, ttlSeconds?: number): Promise<void> => {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await redis.setex(key, ttlSeconds, serialized);
      } else {
        await redis.set(key, serialized);
      }
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
    }
  },

  // Delete cached data
  del: async (key: string): Promise<void> => {
    try {
      await redis.del(key);
    } catch (error) {
      console.error(`Cache delete error for key ${key}:`, error);
    }
  },

  // Check if key exists
  exists: async (key: string): Promise<boolean> => {
    try {
      const result = await redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error(`Cache exists error for key ${key}:`, error);
      return false;
    }
  },

  // Increment counter
  incr: async (key: string, ttlSeconds?: number): Promise<number> => {
    try {
      const result = await redis.incr(key);
      if (ttlSeconds && result === 1) {
        await redis.expire(key, ttlSeconds);
      }
      return result;
    } catch (error) {
      console.error(`Cache increment error for key ${key}:`, error);
      return 0;
    }
  },

  // Get multiple keys
  mget: async <T>(keys: string[]): Promise<(T | null)[]> => {
    try {
      const results = await redis.mget(keys);
      return results.map(result => result ? JSON.parse(result) : null);
    } catch (error) {
      console.error(`Cache mget error for keys ${keys.join(', ')}:`, error);
      return keys.map(() => null);
    }
  },

  // Set multiple keys
  mset: async (data: Record<string, any>, ttlSeconds?: number): Promise<void> => {
    try {
      const pipeline = redis.pipeline();
      Object.entries(data).forEach(([key, value]) => {
        const serialized = JSON.stringify(value);
        if (ttlSeconds) {
          pipeline.setex(key, ttlSeconds, serialized);
        } else {
          pipeline.set(key, serialized);
        }
      });
      await pipeline.exec();
    } catch (error) {
      console.error('Cache mset error:', error);
    }
  },

  // Add to list
  lpush: async (key: string, value: any): Promise<void> => {
    try {
      await redis.lpush(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Cache lpush error for key ${key}:`, error);
    }
  },

  // Get from list
  lrange: async <T>(key: string, start: number = 0, stop: number = -1): Promise<T[]> => {
    try {
      const results = await redis.lrange(key, start, stop);
      return results.map(result => JSON.parse(result));
    } catch (error) {
      console.error(`Cache lrange error for key ${key}:`, error);
      return [];
    }
  },

  // Add to sorted set
  zadd: async (key: string, score: number, value: any): Promise<void> => {
    try {
      await redis.zadd(key, score, JSON.stringify(value));
    } catch (error) {
      console.error(`Cache zadd error for key ${key}:`, error);
    }
  },

  // Get from sorted set
  zrange: async <T>(key: string, start: number = 0, stop: number = -1, withScores: boolean = false): Promise<T[]> => {
    try {
      let results;
      if (withScores) {
        results = await redis.zrange(key, start, stop, 'WITHSCORES');
        // Group results into pairs [value, score]
        const grouped = [];
        for (let i = 0; i < results.length; i += 2) {
          grouped.push([JSON.parse(results[i]), parseFloat(results[i + 1])]);
        }
        return grouped as any;
      } else {
        results = await redis.zrange(key, start, stop);
        return results.map(result => JSON.parse(result));
      }
    } catch (error) {
      console.error(`Cache zrange error for key ${key}:`, error);
      return [];
    }
  },

  // Get by score from sorted set
  zrangebyscore: async <T>(key: string, min: number, max: number, limit?: { offset: number; count: number }): Promise<T[]> => {
    try {
      let results;
      if (limit) {
        results = await redis.zrangebyscore(key, min, max, 'LIMIT', limit.offset, limit.count);
      } else {
        results = await redis.zrangebyscore(key, min, max);
      }
      return results.map(result => JSON.parse(result));
    } catch (error) {
      console.error(`Cache zrangebyscore error for key ${key}:`, error);
      return [];
    }
  },
};

// Session management
export const session = {
  create: async (sessionId: string, userId: string, data: any, ttlSeconds: number = 7 * 24 * 60 * 60): Promise<void> => {
    await cache.set(`session:${sessionId}`, { userId, ...data }, ttlSeconds);
  },

  get: async (sessionId: string): Promise<any | null> => {
    return await cache.get(`session:${sessionId}`);
  },

  update: async (sessionId: string, data: any, ttlSeconds: number = 7 * 24 * 60 * 60): Promise<void> => {
    const existing = await session.get(sessionId);
    if (existing) {
      await cache.set(`session:${sessionId}`, { ...existing, ...data }, ttlSeconds);
    }
  },

  destroy: async (sessionId: string): Promise<void> => {
    await cache.del(`session:${sessionId}`);
  },
};

// Rate limiting
export const rateLimit = {
  check: async (key: string, windowSeconds: number, maxRequests: number): Promise<{ allowed: boolean; remaining: number; resetTime: number }> => {
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);
    
    // Remove old entries
    await redis.zremrangebyscore(key, 0, windowStart);
    
    // Count current requests
    const currentCount = await redis.zcard(key);
    
    if (currentCount >= maxRequests) {
      const oldestEntry = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const resetTime = oldestEntry.length > 0 ? parseInt(oldestEntry[1]) + (windowSeconds * 1000) : now;
      
      return {
        allowed: false,
        remaining: 0,
        resetTime,
      };
    }
    
    // Add current request
    await redis.zadd(key, now, now);
    await redis.expire(key, windowSeconds);
    
    return {
      allowed: true,
      remaining: maxRequests - currentCount - 1,
      resetTime: now + (windowSeconds * 1000),
    };
  },
};

export default redis;

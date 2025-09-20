import { Client } from '@elastic/elasticsearch';
import logger from '../utils/logger';

const client = new Client({
  node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
});

export const initializeElasticsearch = async () => {
  try {
    const health = await client.cluster.health();
    logger.info('Elasticsearch connected:', health.cluster_name);
    
    // Create indices if they don't exist
    await createIndices();
  } catch (error) {
    logger.error('Elasticsearch connection failed:', error);
    throw error;
  }
};

const createIndices = async () => {
  const indices = [
    {
      index: 'videos',
      body: {
        mappings: {
          properties: {
            id: { type: 'keyword' },
            title: { type: 'text', analyzer: 'standard' },
            description: { type: 'text', analyzer: 'standard' },
            tags: { type: 'keyword' },
            category: { type: 'keyword' },
            channelId: { type: 'keyword' },
            channelName: { type: 'text' },
            views: { type: 'integer' },
            likes: { type: 'integer' },
            duration: { type: 'integer' },
            createdAt: { type: 'date' },
            thumbnail: { type: 'keyword' },
            privacy: { type: 'keyword' },
            status: { type: 'keyword' },
          },
        },
      },
    },
    {
      index: 'users',
      body: {
        mappings: {
          properties: {
            id: { type: 'keyword' },
            username: { type: 'text', analyzer: 'standard' },
            email: { type: 'keyword' },
            firstName: { type: 'text' },
            lastName: { type: 'text' },
            createdAt: { type: 'date' },
            isVerified: { type: 'boolean' },
            role: { type: 'keyword' },
          },
        },
      },
    },
    {
      index: 'channels',
      body: {
        mappings: {
          properties: {
            id: { type: 'keyword' },
            name: { type: 'text', analyzer: 'standard' },
            description: { type: 'text', analyzer: 'standard' },
            userId: { type: 'keyword' },
            subscriberCount: { type: 'integer' },
            videoCount: { type: 'integer' },
            createdAt: { type: 'date' },
            isVerified: { type: 'boolean' },
          },
        },
      },
    },
  ];

  for (const indexConfig of indices) {
    try {
      const exists = await client.indices.exists({ index: indexConfig.index });
      if (!exists) {
        await client.indices.create(indexConfig);
        logger.info(`Created Elasticsearch index: ${indexConfig.index}`);
      }
    } catch (error) {
      logger.error(`Error creating index ${indexConfig.index}:`, error);
    }
  }
};

// Search utilities
export const search = {
  videos: async (query: string, filters: any = {}, limit: number = 20, offset: number = 0) => {
    try {
      const searchBody: any = {
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query,
                  fields: ['title^2', 'description', 'tags', 'channelName'],
                  type: 'best_fields',
                  fuzziness: 'AUTO',
                },
              },
            ],
            filter: [
              { term: { status: 'PUBLISHED' } },
              { term: { privacy: 'PUBLIC' } },
            ],
          },
        },
        sort: [
          { _score: { order: 'desc' } },
          { views: { order: 'desc' } },
          { createdAt: { order: 'desc' } },
        ],
        from: offset,
        size: limit,
      };

      // Add filters
      if (filters.category) {
        searchBody.query.bool.filter.push({ term: { category: filters.category } });
      }
      if (filters.duration) {
        const { min, max } = filters.duration;
        searchBody.query.bool.filter.push({
          range: { duration: { gte: min, lte: max } },
        });
      }
      if (filters.uploadDate) {
        searchBody.query.bool.filter.push({
          range: { createdAt: { gte: filters.uploadDate } },
        });
      }

      const result = await client.search({
        index: 'videos',
        body: searchBody,
      });

      return {
        videos: result.hits.hits.map((hit: any) => hit._source),
        total: result.hits.total.value,
      };
    } catch (error) {
      logger.error('Video search error:', error);
      return { videos: [], total: 0 };
    }
  },

  channels: async (query: string, limit: number = 20, offset: number = 0) => {
    try {
      const result = await client.search({
        index: 'channels',
        body: {
          query: {
            multi_match: {
              query,
              fields: ['name^2', 'description'],
              type: 'best_fields',
              fuzziness: 'AUTO',
            },
          },
          sort: [
            { _score: { order: 'desc' } },
            { subscriberCount: { order: 'desc' } },
          ],
          from: offset,
          size: limit,
        },
      });

      return {
        channels: result.hits.hits.map((hit: any) => hit._source),
        total: result.hits.total.value,
      };
    } catch (error) {
      logger.error('Channel search error:', error);
      return { channels: [], total: 0 };
    }
  },

  indexVideo: async (video: any) => {
    try {
      await client.index({
        index: 'videos',
        id: video.id,
        body: video,
      });
    } catch (error) {
      logger.error('Video indexing error:', error);
    }
  },

  indexChannel: async (channel: any) => {
    try {
      await client.index({
        index: 'channels',
        id: channel.id,
        body: channel,
      });
    } catch (error) {
      logger.error('Channel indexing error:', error);
    }
  },

  deleteVideo: async (videoId: string) => {
    try {
      await client.delete({
        index: 'videos',
        id: videoId,
      });
    } catch (error) {
      logger.error('Video deletion error:', error);
    }
  },
};

export { client as elasticsearch };

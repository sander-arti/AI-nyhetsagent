import { z } from 'zod';
import { NewsItemSchema, DebateItemSchema, DevItemSchema } from '../types/schemas.js';

/**
 * Convert Zod schemas to JSON Schema format for OpenAI's structured outputs
 */

export const NewsItemJSONSchema = {
  type: 'object',
  properties: {
    videoId: { type: 'string' },
    channelId: { type: 'string' },
    sourceUrl: { type: 'string' },
    timestamp: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    rawContext: { type: 'string', minLength: 20 },
    relevance_score: { type: 'integer', minimum: 1, maximum: 10 },
    title: { type: 'string', minLength: 5, maxLength: 120 },
    summary: { type: 'string', minLength: 10, maxLength: 250 },
    entities: {
      type: 'array',
      items: { type: 'string' },
      default: []
    },
    type: {
      type: 'string',
      enum: ['release', 'tool', 'policy', 'research', 'acquisition', 'funding', 'other']
    },
    impact: { type: 'string', enum: ['breaking', 'significant', 'minor'] },
    affectedCompanies: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['videoId', 'channelId', 'sourceUrl', 'confidence', 'rawContext', 'relevance_score', 'title', 'summary', 'entities', 'type'],
  additionalProperties: false
};

export const DebateItemJSONSchema = {
  type: 'object',
  properties: {
    videoId: { type: 'string' },
    channelId: { type: 'string' },
    sourceUrl: { type: 'string' },
    timestamp: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    rawContext: { type: 'string', minLength: 20 },
    relevance_score: { type: 'integer', minimum: 1, maximum: 10 },
    topic: { type: 'string', minLength: 5, maxLength: 100 },
    whatWasDiscussed: { type: 'string', minLength: 20, maxLength: 400 },
    positions: {
      type: 'object',
      properties: {
        pro: { type: 'array', items: { type: 'string' } },
        contra: { type: 'array', items: { type: 'string' } }
      },
      required: ['pro', 'contra']
    },
    keyQuotes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string', minLength: 10 },
          timestamp: { type: 'string' }
        },
        required: ['quote', 'timestamp']
      },
      maxItems: 5
    },
    implications: { type: 'string', minLength: 10, maxLength: 300 }
  },
  required: ['videoId', 'channelId', 'sourceUrl', 'confidence', 'rawContext', 'relevance_score', 'topic', 'whatWasDiscussed', 'positions', 'keyQuotes', 'implications'],
  additionalProperties: false
};

export const DevItemJSONSchema = {
  type: 'object',
  properties: {
    videoId: { type: 'string' },
    channelId: { type: 'string' },
    sourceUrl: { type: 'string' },
    timestamp: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    rawContext: { type: 'string', minLength: 20 },
    relevance_score: { type: 'integer', minimum: 1, maximum: 10 },
    title: { type: 'string', minLength: 5, maxLength: 100 },
    changeType: {
      type: 'string',
      enum: ['release', 'breaking', 'feature', 'tutorial', 'tool', 'api', 'framework', 'library']
    },
    whatChanged: { type: 'string', minLength: 10, maxLength: 300 },
    developerAction: {
      type: 'string',
      enum: ['try', 'update', 'evaluate', 'migrate', 'test', 'learn']
    },
    links: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['videoId', 'channelId', 'sourceUrl', 'confidence', 'rawContext', 'relevance_score', 'title', 'changeType', 'whatChanged', 'developerAction', 'links'],
  additionalProperties: false
};

/**
 * Get JSON schema for source type
 */
export function getJSONSchemaForSourceType(sourceType: 'news' | 'debate' | 'dev') {
  const schemas = {
    news: NewsItemJSONSchema,
    debate: DebateItemJSONSchema,
    dev: DevItemJSONSchema
  };

  return schemas[sourceType];
}

/**
 * Create response format for OpenAI with JSON schema
 */
export function createResponseFormat(sourceType: 'news' | 'debate' | 'dev') {
  const schema = getJSONSchemaForSourceType(sourceType);

  return {
    type: 'json_schema' as const,
    json_schema: {
      name: `${sourceType}_extraction`,
      description: `Extract structured ${sourceType} items from video transcript`,
      schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: schema
          }
        },
        required: ['items'],
        additionalProperties: false
      }
    }
  };
}

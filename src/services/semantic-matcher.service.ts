/**
 * Semantic Matcher Service
 *
 * Advanced similarity matching that goes beyond simple embedding similarity.
 * Considers entity overlap, event types, sentiment, and temporal proximity.
 */

import { ParsedItem } from '../types/schemas.js';
import { EventType, ContextualSimilarity } from '../types/dedup.types.js';
import OpenAI from 'openai';

export class SemanticMatcherService {
  private openai: OpenAI;
  private eventTypeCache: Map<string, EventType> = new Map();

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Calculate entity overlap between two items (Jaccard similarity)
   */
  calculateEntityOverlap(item1: ParsedItem, item2: ParsedItem): number {
    const entities1 = this.extractEntities(item1);
    const entities2 = this.extractEntities(item2);

    if (entities1.size === 0 && entities2.size === 0) {
      return 0.5; // Neutral score if no entities
    }

    if (entities1.size === 0 || entities2.size === 0) {
      return 0; // No overlap if one has no entities
    }

    // Jaccard similarity: intersection / union
    const intersection = new Set([...entities1].filter(e => entities2.has(e)));
    const union = new Set([...entities1, ...entities2]);

    return intersection.size / union.size;
  }

  /**
   * Extract and normalize entities from item
   */
  private extractEntities(item: ParsedItem): Set<string> {
    const entities = new Set<string>();

    if ('entities' in item && item.entities) {
      item.entities.forEach(entity => {
        // Normalize: lowercase and trim
        entities.add(entity.toLowerCase().trim());
      });
    }

    return entities;
  }

  /**
   * Classify event type using LLM (with caching)
   */
  async classifyEventType(item: ParsedItem): Promise<EventType> {
    // Create cache key from item content
    const cacheKey = this.createCacheKey(item);

    // Check cache first
    if (this.eventTypeCache.has(cacheKey)) {
      return this.eventTypeCache.get(cacheKey)!;
    }

    // Extract text for classification
    const text = this.extractTextForClassification(item);

    if (!text) {
      return 'other';
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a news event classifier. Classify the following news into ONE of these categories:
- product_launch: New product, feature, or service launch
- company_announcement: Company news, strategy, leadership changes
- funding_round: Investment, fundraising, IPO
- acquisition: Mergers, acquisitions, buyouts
- research_breakthrough: Scientific discovery, research findings
- controversy: Scandals, controversies, ethical issues
- regulation: Laws, regulations, policy changes
- market_movement: Stock prices, market trends
- partnership: Collaborations, partnerships, alliances
- other: Anything else

Respond with ONLY the category name, nothing else.`,
          },
          {
            role: 'user',
            content: text,
          },
        ],
        temperature: 0.1,
        max_tokens: 20,
      });

      const classification = response.choices[0]?.message?.content?.trim().toLowerCase();

      // Map to EventType
      const eventType = this.mapToEventType(classification || 'other');

      // Cache result
      this.eventTypeCache.set(cacheKey, eventType);

      return eventType;
    } catch (error) {
      console.warn('⚠️ Event classification failed:', error);
      return 'other';
    }
  }

  /**
   * Create cache key from item
   */
  private createCacheKey(item: ParsedItem): string {
    if ('title' in item) {
      return item.title?.substring(0, 100) || 'unknown';
    }
    if ('topic' in item) {
      return item.topic?.substring(0, 100) || 'unknown';
    }
    return 'unknown';
  }

  /**
   * Extract text for event classification
   */
  private extractTextForClassification(item: ParsedItem): string {
    let text = '';

    if ('title' in item && item.title) {
      text += item.title + '. ';
    } else if ('topic' in item && item.topic) {
      text += item.topic + '. ';
    }

    if ('summary' in item && item.summary) {
      text += item.summary.substring(0, 200);
    } else if ('whatWasDiscussed' in item && item.whatWasDiscussed) {
      text += item.whatWasDiscussed.substring(0, 200);
    }

    return text.trim();
  }

  /**
   * Map classification string to EventType
   */
  private mapToEventType(classification: string): EventType {
    const mapping: Record<string, EventType> = {
      product_launch: 'product_launch',
      company_announcement: 'company_announcement',
      funding_round: 'funding_round',
      acquisition: 'acquisition',
      research_breakthrough: 'research_breakthrough',
      controversy: 'controversy',
      regulation: 'regulation',
      market_movement: 'market_movement',
      partnership: 'partnership',
    };

    return mapping[classification] || 'other';
  }

  /**
   * Calculate event type similarity
   */
  calculateEventTypeSimilarity(type1: EventType, type2: EventType): number {
    // Exact match
    if (type1 === type2) {
      return 1.0;
    }

    // Related types (some overlap)
    const relatedGroups = [
      ['product_launch', 'company_announcement'],
      ['funding_round', 'acquisition'],
      ['regulation', 'controversy'],
      ['research_breakthrough', 'company_announcement'],
    ];

    for (const group of relatedGroups) {
      if (group.includes(type1) && group.includes(type2)) {
        return 0.5; // Partial match
      }
    }

    // No relation
    return 0;
  }

  /**
   * Calculate temporal proximity (0-1)
   */
  calculateTemporalProximity(date1: Date, date2: Date): number {
    const hoursDiff = Math.abs(date1.getTime() - date2.getTime()) / (1000 * 60 * 60);

    // Same day: high proximity
    if (hoursDiff <= 24) {
      return 1.0;
    }

    // Within a week: moderate proximity
    if (hoursDiff <= 7 * 24) {
      return 0.7;
    }

    // Within a month: low proximity
    if (hoursDiff <= 30 * 24) {
      return 0.3;
    }

    // Older: minimal proximity
    return 0.1;
  }

  /**
   * Estimate sentiment similarity (simple heuristic)
   */
  calculateSentimentSimilarity(item1: ParsedItem, item2: ParsedItem): number {
    // Simple keyword-based sentiment detection
    const sentiment1 = this.detectSentiment(item1);
    const sentiment2 = this.detectSentiment(item2);

    if (sentiment1 === sentiment2) {
      return 1.0;
    }

    // Opposite sentiments
    if (
      (sentiment1 === 'positive' && sentiment2 === 'negative') ||
      (sentiment1 === 'negative' && sentiment2 === 'positive')
    ) {
      return 0;
    }

    // Neutral cases
    return 0.5;
  }

  /**
   * Simple sentiment detection
   */
  private detectSentiment(item: ParsedItem): 'positive' | 'negative' | 'neutral' {
    const text = this.extractTextForClassification(item).toLowerCase();

    const positiveWords = [
      'launch',
      'success',
      'achievement',
      'breakthrough',
      'innovative',
      'growth',
      'partnership',
    ];
    const negativeWords = [
      'controversy',
      'scandal',
      'failure',
      'lawsuit',
      'decline',
      'issue',
      'problem',
    ];

    let positiveCount = 0;
    let negativeCount = 0;

    positiveWords.forEach(word => {
      if (text.includes(word)) positiveCount++;
    });

    negativeWords.forEach(word => {
      if (text.includes(word)) negativeCount++;
    });

    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  /**
   * Calculate multi-factor contextual similarity
   */
  async calculateContextualSimilarity(
    item1: ParsedItem,
    item2: ParsedItem,
    embeddingSimilarity: number,
    publishedDate1: Date,
    publishedDate2: Date
  ): Promise<ContextualSimilarity> {
    // Calculate all factors
    const entityOverlap = this.calculateEntityOverlap(item1, item2);
    const temporalProximity = this.calculateTemporalProximity(publishedDate1, publishedDate2);
    const sentimentSimilarity = this.calculateSentimentSimilarity(item1, item2);

    // Classify event types (with caching)
    const eventType1 = await this.classifyEventType(item1);
    const eventType2 = await this.classifyEventType(item2);
    const eventTypeSimilarity = this.calculateEventTypeSimilarity(eventType1, eventType2);

    // Weights for each factor
    const weights = {
      embedding: 0.40, // Embedding is still most important
      entity: 0.25, // Entity overlap is strong signal
      event: 0.15, // Event type matters
      temporal: 0.10, // Temporal proximity
      sentiment: 0.10, // Sentiment alignment
    };

    // Calculate weighted overall score
    const overallScore =
      embeddingSimilarity * weights.embedding +
      entityOverlap * weights.entity +
      eventTypeSimilarity * weights.event +
      temporalProximity * weights.temporal +
      sentimentSimilarity * weights.sentiment;

    return {
      embeddingSimilarity,
      entityOverlap,
      eventTypeSimilarity,
      temporalProximity,
      sentimentSimilarity,
      overallScore,
      breakdown: {
        embedding: { score: embeddingSimilarity, weight: weights.embedding },
        entity: { score: entityOverlap, weight: weights.entity },
        event: { score: eventTypeSimilarity, weight: weights.event },
        temporal: { score: temporalProximity, weight: weights.temporal },
        sentiment: { score: sentimentSimilarity, weight: weights.sentiment },
      },
    };
  }

  /**
   * Clear event type cache
   */
  clearCache(): void {
    this.eventTypeCache.clear();
  }
}

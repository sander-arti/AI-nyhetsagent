/**
 * Context-Aware Deduplication Type Definitions
 *
 * Enhanced types for temporal-aware, source-aware, and semantic deduplication
 */

import { ParsedItem } from './schemas.js';

/**
 * Temporal context for understanding when news was published/discovered
 */
export interface TemporalContext {
  publishedAt: Date;
  discoveredAt: Date;
  timeWindow: '24h' | '7d' | '30d' | '90d';
  itemAge: number; // hours since published
  storyPhase: 'breaking' | 'follow-up' | 'analysis' | 'historical';
}

/**
 * Source reputation metrics
 */
export interface SourceReputation {
  sourceId: string;
  sourceName: string;
  reliabilityScore: number; // 0-1 (based on validation success rate)
  avgResponseTime: number; // average hours to report news
  specialization: string[]; // e.g., ['ai', 'crypto', 'enterprise']
  historicalAccuracy: number; // 0-1 (how often items pass validation)
  totalItemsPublished: number;
  firstReportCount: number; // how often they reported first
}

/**
 * Coverage timeline entry
 */
export interface CoverageTimelineEntry {
  source: string;
  sourceId: string;
  publishedAt: Date;
  itemId: string;
  confidence: string;
  addedValue: string; // what new info this source added
}

/**
 * Enhanced cluster with temporal and source context
 */
export interface ContextualCluster {
  id: string;
  canonical: ParsedItem & ContextualItem;
  members: Array<ParsedItem & ContextualItem>;
  similarity_scores: number[];

  // Temporal context
  temporalContext: TemporalContext;
  firstReportedBy: string; // source_id
  firstReportedAt: Date;
  coverageTimeline: CoverageTimelineEntry[];

  // Source context
  sourceDiversity: number; // 0-1, how many unique sources
  avgSourceReputation: number;

  // Semantic context
  commonEntities: string[];
  eventType?: EventType;
  sentimentAlignment: number; // 0-1, how aligned sentiments are

  // Quality metrics
  avg_similarity_score: number;
  clusterQualityScore: number; // overall quality 0-1

  // Historical
  also_covered_by: string[]; // channel/video IDs
  isHistoricalMatch: boolean; // matched with historical items
  historicalClusterId?: string;
}

/**
 * Contextual information added to each item
 */
export interface ContextualItem {
  itemId: string;
  sourceReputation?: SourceReputation;
  isFirstReport: boolean;
  temporalPhase: 'breaking' | 'follow-up' | 'analysis' | 'historical';
  contextualScore: number; // overall score for canonical selection
  entityCount: number;
  contentQuality: number; // 0-1
}

/**
 * Event types for classification
 */
export type EventType =
  | 'product_launch'
  | 'company_announcement'
  | 'funding_round'
  | 'acquisition'
  | 'research_breakthrough'
  | 'controversy'
  | 'regulation'
  | 'market_movement'
  | 'partnership'
  | 'other';

/**
 * Multi-factor similarity result
 */
export interface ContextualSimilarity {
  embeddingSimilarity: number;
  entityOverlap: number;
  eventTypeSimilarity: number;
  temporalProximity: number;
  sentimentSimilarity: number;
  overallScore: number;
  breakdown: {
    embedding: { score: number; weight: number };
    entity: { score: number; weight: number };
    event: { score: number; weight: number };
    temporal: { score: number; weight: number };
    sentiment: { score: number; weight: number };
  };
}

/**
 * Historical deduplication result
 */
export interface HistoricalDedupResult {
  newItems: ParsedItem[];
  duplicatesOfHistory: Array<{
    newItem: ParsedItem;
    historicalItem: ParsedItem;
    historicalClusterId: string;
    similarity: number;
    action: 'merged' | 'marked_duplicate' | 'kept_separate';
  }>;
  updatedItems: Array<{
    itemId: string;
    updates: Partial<ParsedItem>;
    reason: string;
  }>;
}

/**
 * Deduplication configuration
 */
export interface DedupConfig {
  temporal: {
    breakingNewsWindow: number; // hours
    followUpWindow: number; // hours
    analysisThreshold: number; // hours
  };
  similarity: {
    breakingNewsThreshold: number;
    followUpThreshold: number;
    analysisThreshold: number;
    historicalThreshold: number;
  };
  scoring: {
    sourceReputationWeight: number;
    recencyWeight: number;
    contentQualityWeight: number;
    firstReportWeight: number;
  };
  features: {
    enableTemporalClustering: boolean;
    enableSourceScoring: boolean;
    enableSemanticMatching: boolean;
    enableCrossRunDedup: boolean;
    enableEntityMatching: boolean;
  };
}

/**
 * Deduplication statistics
 */
export interface DedupStats {
  total_clusters: number;
  total_items_processed: number;
  avg_cluster_size: number;
  duplicate_rate: number;
  temporal_breakdown: {
    breaking: number;
    followUp: number;
    analysis: number;
    historical: number;
  };
  source_diversity: number;
  avg_cluster_quality: number;
}

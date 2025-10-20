/**
 * Types for Multi-Model Consensus System
 *
 * Supports ensemble voting and hierarchical validation across multiple LLM providers
 */

import { ParsedItem } from './schemas.js';

/**
 * Supported LLM providers
 */
export type ModelProvider = 'openai' | 'anthropic' | 'google';

/**
 * Model tier for hierarchical consensus
 */
export type ModelTier = 1 | 2 | 3;

/**
 * Model configuration
 */
export interface ModelConfig {
  provider: ModelProvider;
  modelId: string;
  tier: ModelTier;
  costPer1kTokens: {
    input: number;
    output: number;
  };
  maxTokens: number;
  temperature: number;
  enabled: boolean;
}

/**
 * Consensus strategy type
 */
export type ConsensusStrategy = 'ensemble' | 'hierarchical' | 'hybrid';

/**
 * Consensus configuration
 */
export interface ConsensusConfig {
  strategy: ConsensusStrategy;

  // Ensemble voting settings
  ensemble: {
    enabled: boolean;
    minimumAgreement: number; // 2 of 3, 3 of 5, etc.
    models: string[]; // Model IDs to use
  };

  // Hierarchical validation settings
  hierarchical: {
    enabled: boolean;
    tier1Model: string; // Fast, cheap model (e.g., GPT-4o-mini)
    tier2Model: string; // More accurate model (e.g., GPT-4o)
    tier3Model: string; // High-quality arbiter (e.g., Claude 3.5 Sonnet)
    tier2Threshold: number; // Confidence threshold to trigger Tier 2 (e.g., 0.7)
    conflictThreshold: number; // Disagreement threshold to trigger Tier 3 (e.g., 0.3)
  };

  // Conflict resolution settings
  conflictResolution: {
    method: 'arbiter' | 'weighted_vote' | 'highest_confidence';
    arbiterModel?: string; // Model to use for tie-breaking
    confidenceWeights: Record<string, number>; // Model reliability weights
  };

  // Performance settings
  enableCaching: boolean;
  parallelExecution: boolean;
  timeoutMs: number;
}

/**
 * Result from a single model
 */
export interface ModelResult {
  modelId: string;
  provider: ModelProvider;
  tier: ModelTier;
  items: ParsedItem[];
  confidence: number;
  cost: number;
  processingTimeMs: number;
  tokenUsage: {
    input: number;
    output: number;
  };
  error?: string;
}

/**
 * Item-level consensus result
 */
export interface ItemConsensus {
  item: ParsedItem;
  agreementCount: number; // How many models agreed on this item
  totalModels: number;
  agreementRatio: number; // agreementCount / totalModels
  modelVotes: Array<{
    modelId: string;
    agreed: boolean;
    confidence: number;
    variant?: ParsedItem; // If model had slightly different version
  }>;
  conflictResolved: boolean;
  resolvedBy?: string; // Model ID that resolved conflict
  finalConfidence: number;
}

/**
 * Consensus validation result
 */
export interface ConsensusResult {
  strategy: ConsensusStrategy;
  items: ParsedItem[];
  itemConsensus: ItemConsensus[];

  // Model results
  modelResults: ModelResult[];

  // Consensus metrics
  metrics: {
    totalModelsUsed: number;
    tier1Items: number; // Items validated by Tier 1 only
    tier2Items: number; // Items requiring Tier 2
    tier3Items: number; // Items requiring Tier 3 arbitration
    averageAgreement: number; // Average agreement ratio across all items
    conflictsResolved: number;
    totalCost: number;
    totalProcessingTimeMs: number;
  };

  // Quality indicators
  quality: {
    highConfidenceItems: number; // Items with >0.8 agreement
    mediumConfidenceItems: number; // Items with 0.5-0.8 agreement
    lowConfidenceItems: number; // Items with <0.5 agreement
    estimatedAccuracy: number; // Based on agreement ratios
  };
}

/**
 * Conflict between models
 */
export interface ModelConflict {
  itemId: string;
  conflictType: 'presence' | 'content' | 'confidence';
  models: Array<{
    modelId: string;
    item?: ParsedItem;
    confidence: number;
  }>;
  disagreementScore: number; // 0-1, how much models disagree
  needsArbitration: boolean;
}

/**
 * Model performance metrics (for tracking which models work best)
 */
export interface ModelPerformanceMetrics {
  modelId: string;
  provider: ModelProvider;

  // Usage stats
  totalRequests: number;
  totalItems: number;
  averageItemsPerRequest: number;

  // Quality stats
  averageConfidence: number;
  highConfidenceRate: number; // % of items with >0.8 confidence
  agreementRate: number; // How often this model agrees with consensus

  // Performance stats
  averageProcessingTimeMs: number;
  averageCost: number;
  totalCost: number;

  // Reliability stats
  errorRate: number;
  timeoutRate: number;

  // Updated timestamp
  lastUpdated: Date;
}

/**
 * Cache entry for model results
 */
export interface ConsensusCacheEntry {
  cacheKey: string;
  modelId: string;
  result: ModelResult;
  timestamp: Date;
  expiresAt: Date;
}

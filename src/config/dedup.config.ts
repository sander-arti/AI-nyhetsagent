/**
 * Context-Aware Deduplication Configuration
 *
 * Centralized configuration for all deduplication parameters
 */

import { DedupConfig } from '../types/dedup.types.js';

export const DEFAULT_DEDUP_CONFIG: DedupConfig = {
  temporal: {
    breakingNewsWindow: 24, // hours - news within 24h is "breaking"
    followUpWindow: 7 * 24, // hours - 7 days for follow-ups
    analysisThreshold: 30 * 24, // hours - 30 days, after that it's analysis/historical
  },

  similarity: {
    breakingNewsThreshold: 0.92, // Very strict for recent breaking news
    followUpThreshold: 0.88, // Moderate for follow-up stories
    analysisThreshold: 0.85, // More lenient for analysis pieces
    historicalThreshold: 0.88, // Cross-run dedup threshold
  },

  scoring: {
    sourceReputationWeight: 0.3, // How much source reliability matters
    recencyWeight: 0.2, // How much recency matters (higher = prefer newer)
    contentQualityWeight: 0.3, // How much content completeness matters
    firstReportWeight: 0.2, // Bonus for being first to report
  },

  features: {
    enableTemporalClustering: true, // Enable time-aware clustering
    enableSourceScoring: true, // Enable source reputation scoring
    enableSemanticMatching: true, // Enable multi-factor similarity
    enableCrossRunDedup: true, // Enable dedup against historical items
    enableEntityMatching: true, // Enable entity-based matching
  },
};

/**
 * Get similarity threshold based on temporal context
 */
export function getSimilarityThreshold(
  itemAgeHours: number,
  config: DedupConfig = DEFAULT_DEDUP_CONFIG
): number {
  if (itemAgeHours <= config.temporal.breakingNewsWindow) {
    return config.similarity.breakingNewsThreshold;
  } else if (itemAgeHours <= config.temporal.followUpWindow) {
    return config.similarity.followUpThreshold;
  } else {
    return config.similarity.analysisThreshold;
  }
}

/**
 * Determine story phase based on item age
 */
export function determineStoryPhase(
  publishedAt: Date,
  firstReportedAt?: Date,
  config: DedupConfig = DEFAULT_DEDUP_CONFIG
): 'breaking' | 'follow-up' | 'analysis' | 'historical' {
  const now = new Date();
  const ageHours = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60);

  // If this is the first report or within breaking window
  if (!firstReportedAt || ageHours <= config.temporal.breakingNewsWindow) {
    return 'breaking';
  }

  // Calculate hours since first report
  const hoursSinceFirst =
    (publishedAt.getTime() - firstReportedAt.getTime()) / (1000 * 60 * 60);

  if (hoursSinceFirst <= config.temporal.breakingNewsWindow) {
    return 'breaking';
  } else if (hoursSinceFirst <= config.temporal.followUpWindow) {
    return 'follow-up';
  } else if (hoursSinceFirst <= config.temporal.analysisThreshold) {
    return 'analysis';
  } else {
    return 'historical';
  }
}

/**
 * Calculate time window for clustering
 */
export function determineTimeWindow(
  itemAgeHours: number,
  config: DedupConfig = DEFAULT_DEDUP_CONFIG
): '24h' | '7d' | '30d' | '90d' {
  if (itemAgeHours <= 24) {
    return '24h';
  } else if (itemAgeHours <= 7 * 24) {
    return '7d';
  } else if (itemAgeHours <= 30 * 24) {
    return '30d';
  } else {
    return '90d';
  }
}

/**
 * Get recency bonus (0-1) based on item age
 */
export function calculateRecencyBonus(
  itemAgeHours: number,
  config: DedupConfig = DEFAULT_DEDUP_CONFIG
): number {
  // Max bonus for items within breaking news window
  if (itemAgeHours <= config.temporal.breakingNewsWindow) {
    return 1.0;
  }

  // Linear decay up to follow-up window
  if (itemAgeHours <= config.temporal.followUpWindow) {
    const decay =
      1.0 -
      (itemAgeHours - config.temporal.breakingNewsWindow) /
        (config.temporal.followUpWindow - config.temporal.breakingNewsWindow);
    return Math.max(0, decay);
  }

  // Minimal bonus for older items
  return 0.1;
}

/**
 * Multi-Model Consensus Service
 *
 * Implements ensemble voting and hierarchical validation across multiple LLM providers
 */

import {
  ConsensusConfig,
  ConsensusResult,
  ModelResult,
  ItemConsensus,
  ModelConflict,
  ModelPerformanceMetrics,
} from '../types/consensus.types.js';
import { ParsedItem } from '../types/schemas.js';
import { getModelConfig } from '../config/consensus.config.js';

export class ConsensusService {
  private config: ConsensusConfig;
  private performanceMetrics: Map<string, ModelPerformanceMetrics> = new Map();

  constructor(config: ConsensusConfig) {
    this.config = config;
  }

  /**
   * Validate items using configured consensus strategy
   */
  async validateWithConsensus(
    modelResults: ModelResult[]
  ): Promise<ConsensusResult> {
    if (this.config.strategy === 'ensemble') {
      return this.ensembleVoting(modelResults);
    } else if (this.config.strategy === 'hierarchical') {
      return this.hierarchicalValidation(modelResults);
    } else {
      // Hybrid strategy: combine both
      return this.hybridConsensus(modelResults);
    }
  }

  /**
   * Ensemble voting: All models vote on every item
   * Requires minimum agreement (e.g., 2 of 3 models)
   */
  private async ensembleVoting(
    modelResults: ModelResult[]
  ): Promise<ConsensusResult> {
    // Collect all unique items from all models
    const allItems = this.collectAllItems(modelResults);

    // Calculate consensus for each item
    const itemConsensus: ItemConsensus[] = [];

    for (const item of allItems) {
      const consensus = this.calculateItemConsensus(item, modelResults);

      // Only include items that meet minimum agreement threshold
      if (consensus.agreementCount >= this.config.ensemble.minimumAgreement) {
        itemConsensus.push(consensus);
      }
    }

    // Extract final items from consensus
    const finalItems = itemConsensus.map((c) => c.item);

    // Calculate metrics
    const metrics = this.calculateMetrics(modelResults, itemConsensus);

    // Calculate quality indicators
    const quality = this.calculateQuality(itemConsensus);

    return {
      strategy: 'ensemble',
      items: finalItems,
      itemConsensus,
      modelResults,
      metrics,
      quality,
    };
  }

  /**
   * Hierarchical validation: Use progressively more expensive models
   * Tier 1 → Tier 2 (low confidence) → Tier 3 (conflicts)
   */
  private async hierarchicalValidation(
    modelResults: ModelResult[]
  ): Promise<ConsensusResult> {
    const tier1Results = modelResults.filter((r) => {
      const config = getModelConfig(r.modelId);
      return config?.tier === 1;
    });

    const tier2Results = modelResults.filter((r) => {
      const config = getModelConfig(r.modelId);
      return config?.tier === 2;
    });

    const tier3Results = modelResults.filter((r) => {
      const config = getModelConfig(r.modelId);
      return config?.tier === 3;
    });

    // Start with Tier 1 items
    let finalItems: ParsedItem[] = [];
    const itemConsensus: ItemConsensus[] = [];

    let tier1Items = 0;
    let tier2Items = 0;
    let tier3Items = 0;

    if (tier1Results.length > 0) {
      const tier1Result = tier1Results[0];

      for (const item of tier1Result.items) {
        const confidence = this.getItemConfidence(item);

        // High confidence items pass directly
        if (confidence >= this.config.hierarchical.tier2Threshold) {
          finalItems.push(item);
          itemConsensus.push({
            item,
            agreementCount: 1,
            totalModels: 1,
            agreementRatio: 1.0,
            modelVotes: [
              {
                modelId: tier1Result.modelId,
                agreed: true,
                confidence,
              },
            ],
            conflictResolved: false,
            finalConfidence: confidence,
          });
          tier1Items++;
        } else {
          // Low confidence items need Tier 2 validation
          if (tier2Results.length > 0) {
            const tier2Consensus = this.validateItemWithTier2(
              item,
              tier1Result,
              tier2Results[0]
            );

            // Check for conflict between Tier 1 and Tier 2
            const disagreement = Math.abs(
              this.getItemConfidence(tier2Consensus.item) - confidence
            );

            if (disagreement > this.config.hierarchical.conflictThreshold) {
              // Conflict detected - use Tier 3 arbiter
              if (tier3Results.length > 0) {
                const tier3Consensus = this.resolveConflictWithTier3(
                  item,
                  tier1Result,
                  tier2Results[0],
                  tier3Results[0]
                );
                finalItems.push(tier3Consensus.item);
                itemConsensus.push(tier3Consensus);
                tier3Items++;
              } else {
                // No Tier 3 available, use Tier 2 result
                finalItems.push(tier2Consensus.item);
                itemConsensus.push(tier2Consensus);
                tier2Items++;
              }
            } else {
              // No significant conflict, use Tier 2 result
              finalItems.push(tier2Consensus.item);
              itemConsensus.push(tier2Consensus);
              tier2Items++;
            }
          } else {
            // No Tier 2 available, use Tier 1 result
            finalItems.push(item);
            itemConsensus.push({
              item,
              agreementCount: 1,
              totalModels: 1,
              agreementRatio: 1.0,
              modelVotes: [
                {
                  modelId: tier1Result.modelId,
                  agreed: true,
                  confidence,
                },
              ],
              conflictResolved: false,
              finalConfidence: confidence,
            });
            tier1Items++;
          }
        }
      }
    }

    // Calculate metrics
    const metrics = {
      ...this.calculateMetrics(modelResults, itemConsensus),
      tier1Items,
      tier2Items,
      tier3Items,
    };

    // Calculate quality indicators
    const quality = this.calculateQuality(itemConsensus);

    return {
      strategy: 'hierarchical',
      items: finalItems,
      itemConsensus,
      modelResults,
      metrics,
      quality,
    };
  }

  /**
   * Hybrid consensus: Combine ensemble and hierarchical approaches
   */
  private async hybridConsensus(
    modelResults: ModelResult[]
  ): Promise<ConsensusResult> {
    // First use hierarchical to filter low-confidence items
    const hierarchicalResult = await this.hierarchicalValidation(modelResults);

    // Then use ensemble voting on remaining items
    const ensembleResult = await this.ensembleVoting(modelResults);

    // Merge results: only keep items that pass both strategies
    const finalItems = hierarchicalResult.items.filter((item) =>
      ensembleResult.items.some((eItem) => this.itemsMatch(item, eItem))
    );

    const itemConsensus = hierarchicalResult.itemConsensus.filter((consensus) =>
      finalItems.some((item) => this.itemsMatch(item, consensus.item))
    );

    const metrics = this.calculateMetrics(modelResults, itemConsensus);
    const quality = this.calculateQuality(itemConsensus);

    return {
      strategy: 'hybrid',
      items: finalItems,
      itemConsensus,
      modelResults,
      metrics,
      quality,
    };
  }

  /**
   * Collect all unique items from model results
   */
  private collectAllItems(modelResults: ModelResult[]): ParsedItem[] {
    const uniqueItems: ParsedItem[] = [];
    const seenKeys = new Set<string>();

    for (const result of modelResults) {
      for (const item of result.items) {
        const key = this.generateItemKey(item);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueItems.push(item);
        }
      }
    }

    return uniqueItems;
  }

  /**
   * Calculate consensus for a single item across all models
   */
  private calculateItemConsensus(
    item: ParsedItem,
    modelResults: ModelResult[]
  ): ItemConsensus {
    const itemKey = this.generateItemKey(item);
    let agreementCount = 0;
    const modelVotes: ItemConsensus['modelVotes'] = [];

    for (const result of modelResults) {
      const matchingItem = result.items.find(
        (i) => this.generateItemKey(i) === itemKey
      );

      if (matchingItem) {
        agreementCount++;
        modelVotes.push({
          modelId: result.modelId,
          agreed: true,
          confidence: this.getItemConfidence(matchingItem),
          variant: matchingItem,
        });
      } else {
        modelVotes.push({
          modelId: result.modelId,
          agreed: false,
          confidence: 0,
        });
      }
    }

    const agreementRatio = agreementCount / modelResults.length;

    // Calculate weighted confidence
    const totalWeight = modelVotes.reduce((sum, vote) => {
      if (vote.agreed) {
        const weight = this.config.conflictResolution.confidenceWeights[vote.modelId] || 1.0;
        return sum + weight;
      }
      return sum;
    }, 0);

    const weightedConfidence = modelVotes.reduce((sum, vote) => {
      if (vote.agreed) {
        const weight = this.config.conflictResolution.confidenceWeights[vote.modelId] || 1.0;
        return sum + vote.confidence * weight;
      }
      return sum;
    }, 0) / (totalWeight || 1);

    return {
      item,
      agreementCount,
      totalModels: modelResults.length,
      agreementRatio,
      modelVotes,
      conflictResolved: false,
      finalConfidence: weightedConfidence,
    };
  }

  /**
   * Validate item with Tier 2 model
   */
  private validateItemWithTier2(
    item: ParsedItem,
    tier1Result: ModelResult,
    tier2Result: ModelResult
  ): ItemConsensus {
    const itemKey = this.generateItemKey(item);
    const tier2Item = tier2Result.items.find(
      (i) => this.generateItemKey(i) === itemKey
    );

    if (tier2Item) {
      // Tier 2 confirms item
      return {
        item: tier2Item,
        agreementCount: 2,
        totalModels: 2,
        agreementRatio: 1.0,
        modelVotes: [
          {
            modelId: tier1Result.modelId,
            agreed: true,
            confidence: this.getItemConfidence(item),
          },
          {
            modelId: tier2Result.modelId,
            agreed: true,
            confidence: this.getItemConfidence(tier2Item),
          },
        ],
        conflictResolved: false,
        finalConfidence: this.getItemConfidence(tier2Item),
      };
    } else {
      // Tier 2 rejects item
      return {
        item,
        agreementCount: 1,
        totalModels: 2,
        agreementRatio: 0.5,
        modelVotes: [
          {
            modelId: tier1Result.modelId,
            agreed: true,
            confidence: this.getItemConfidence(item),
          },
          {
            modelId: tier2Result.modelId,
            agreed: false,
            confidence: 0,
          },
        ],
        conflictResolved: false,
        finalConfidence: this.getItemConfidence(item) * 0.5,
      };
    }
  }

  /**
   * Resolve conflict with Tier 3 arbiter
   */
  private resolveConflictWithTier3(
    item: ParsedItem,
    tier1Result: ModelResult,
    tier2Result: ModelResult,
    tier3Result: ModelResult
  ): ItemConsensus {
    const itemKey = this.generateItemKey(item);
    const tier3Item = tier3Result.items.find(
      (i) => this.generateItemKey(i) === itemKey
    );

    const tier2Item = tier2Result.items.find(
      (i) => this.generateItemKey(i) === itemKey
    );

    // Use Tier 3 result as final arbiter
    const finalItem = tier3Item || item;
    const tier3Confidence = tier3Item ? this.getItemConfidence(tier3Item) : 0;

    return {
      item: finalItem,
      agreementCount: tier3Item ? 2 : 1,
      totalModels: 3,
      agreementRatio: tier3Item ? 0.67 : 0.33,
      modelVotes: [
        {
          modelId: tier1Result.modelId,
          agreed: true,
          confidence: this.getItemConfidence(item),
        },
        {
          modelId: tier2Result.modelId,
          agreed: !!tier2Item,
          confidence: tier2Item ? this.getItemConfidence(tier2Item) : 0,
        },
        {
          modelId: tier3Result.modelId,
          agreed: !!tier3Item,
          confidence: tier3Confidence,
        },
      ],
      conflictResolved: true,
      resolvedBy: tier3Result.modelId,
      finalConfidence: tier3Confidence,
    };
  }

  /**
   * Calculate overall metrics
   */
  private calculateMetrics(
    modelResults: ModelResult[],
    itemConsensus: ItemConsensus[]
  ) {
    const totalCost = modelResults.reduce((sum, r) => sum + r.cost, 0);
    const maxProcessingTime = Math.max(...modelResults.map((r) => r.processingTimeMs));

    const averageAgreement =
      itemConsensus.reduce((sum, c) => sum + c.agreementRatio, 0) /
      (itemConsensus.length || 1);

    const conflictsResolved = itemConsensus.filter((c) => c.conflictResolved).length;

    const tier1Items = itemConsensus.filter((c) => c.totalModels === 1).length;
    const tier2Items = itemConsensus.filter((c) => c.totalModels === 2).length;
    const tier3Items = itemConsensus.filter((c) => c.totalModels >= 3).length;

    return {
      totalModelsUsed: modelResults.length,
      tier1Items,
      tier2Items,
      tier3Items,
      averageAgreement,
      conflictsResolved,
      totalCost,
      totalProcessingTimeMs: maxProcessingTime,
    };
  }

  /**
   * Calculate quality indicators
   */
  private calculateQuality(itemConsensus: ItemConsensus[]) {
    const highConfidenceItems = itemConsensus.filter(
      (c) => c.finalConfidence > 0.8
    ).length;
    const mediumConfidenceItems = itemConsensus.filter(
      (c) => c.finalConfidence >= 0.5 && c.finalConfidence <= 0.8
    ).length;
    const lowConfidenceItems = itemConsensus.filter(
      (c) => c.finalConfidence < 0.5
    ).length;

    // Estimate accuracy based on agreement ratios
    const averageAgreement =
      itemConsensus.reduce((sum, c) => sum + c.agreementRatio, 0) /
      (itemConsensus.length || 1);
    const estimatedAccuracy = 0.92 + averageAgreement * 0.08; // 92% baseline + up to 8% improvement

    return {
      highConfidenceItems,
      mediumConfidenceItems,
      lowConfidenceItems,
      estimatedAccuracy,
    };
  }

  /**
   * Generate unique key for item comparison
   */
  private generateItemKey(item: ParsedItem): string {
    // Use title + first 100 chars of summary as key
    const summaryPrefix = (item.summary || '').substring(0, 100);
    return `${item.title}|${summaryPrefix}`.toLowerCase().trim();
  }

  /**
   * Check if two items match
   */
  private itemsMatch(item1: ParsedItem, item2: ParsedItem): boolean {
    return this.generateItemKey(item1) === this.generateItemKey(item2);
  }

  /**
   * Get item confidence score
   */
  private getItemConfidence(item: ParsedItem): number {
    // Check if item has confidence field
    if ('confidence' in item && typeof item.confidence === 'number') {
      return item.confidence;
    }
    // Default confidence based on relevance
    if (item.relevance >= 8) return 0.9;
    if (item.relevance >= 6) return 0.75;
    if (item.relevance >= 4) return 0.6;
    return 0.5;
  }

  /**
   * Update performance metrics for a model
   */
  updatePerformanceMetrics(modelId: string, result: ModelResult): void {
    const existing = this.performanceMetrics.get(modelId);

    if (existing) {
      // Update existing metrics
      const totalRequests = existing.totalRequests + 1;
      const totalItems = existing.totalItems + result.items.length;
      const averageItemsPerRequest = totalItems / totalRequests;

      const averageConfidence =
        (existing.averageConfidence * existing.totalRequests + result.confidence) /
        totalRequests;

      const highConfidenceCount =
        existing.highConfidenceRate * existing.totalRequests +
        (result.confidence > 0.8 ? 1 : 0);
      const highConfidenceRate = highConfidenceCount / totalRequests;

      const averageProcessingTimeMs =
        (existing.averageProcessingTimeMs * existing.totalRequests +
          result.processingTimeMs) /
        totalRequests;

      const totalCost = existing.totalCost + result.cost;
      const averageCost = totalCost / totalRequests;

      const errorCount = existing.errorRate * existing.totalRequests + (result.error ? 1 : 0);
      const errorRate = errorCount / totalRequests;

      this.performanceMetrics.set(modelId, {
        ...existing,
        totalRequests,
        totalItems,
        averageItemsPerRequest,
        averageConfidence,
        highConfidenceRate,
        averageProcessingTimeMs,
        averageCost,
        totalCost,
        errorRate,
        lastUpdated: new Date(),
      });
    } else {
      // Create new metrics
      this.performanceMetrics.set(modelId, {
        modelId,
        provider: result.provider,
        totalRequests: 1,
        totalItems: result.items.length,
        averageItemsPerRequest: result.items.length,
        averageConfidence: result.confidence,
        highConfidenceRate: result.confidence > 0.8 ? 1.0 : 0.0,
        agreementRate: 0, // Will be calculated separately
        averageProcessingTimeMs: result.processingTimeMs,
        averageCost: result.cost,
        totalCost: result.cost,
        errorRate: result.error ? 1.0 : 0.0,
        timeoutRate: 0,
        lastUpdated: new Date(),
      });
    }
  }

  /**
   * Get performance metrics for a model
   */
  getPerformanceMetrics(modelId: string): ModelPerformanceMetrics | undefined {
    return this.performanceMetrics.get(modelId);
  }

  /**
   * Get all performance metrics
   */
  getAllPerformanceMetrics(): ModelPerformanceMetrics[] {
    return Array.from(this.performanceMetrics.values());
  }
}

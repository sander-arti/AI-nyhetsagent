import { getDatabase } from '../db/database.js';

export interface ExtractionMetrics {
  runId: string;
  sourceType: 'news' | 'debate' | 'dev';
  videoId: string;
  timestamp: Date;

  // Processing stats
  totalChunks: number;
  totalItemsExtracted: number;
  validationFailures: number;
  hallucinationsDetected: number;
  retriesAttempted: number;
  retriesSuccessful: number;

  // Quality metrics
  averageConfidence: number;
  confidenceDistribution: {
    high: number;
    medium: number;
    low: number;
  };

  // Validation stats
  validationErrors: string[];
  validationWarnings: string[];

  // Cost tracking
  tokensUsed: number;
  estimatedCost: number;

  // Processing time
  processingTimeMs: number;
}

export interface AggregatedMetrics {
  totalExtractions: number;
  successRate: number;
  hallucinationRate: number;
  retrySuccessRate: number;
  averageItemsPerVideo: number;
  averageConfidence: number;
  totalCost: number;

  // By source type
  bySourceType: {
    news: MetricsSummary;
    debate: MetricsSummary;
    dev: MetricsSummary;
  };

  // Time period
  startDate: Date;
  endDate: Date;
}

export interface MetricsSummary {
  count: number;
  avgConfidence: number;
  hallucinationRate: number;
  avgItemsExtracted: number;
}

export class LLMMetricsService {
  private db;
  private sessionMetrics: Map<string, ExtractionMetrics>;

  constructor() {
    this.db = getDatabase();
    this.sessionMetrics = new Map();
  }

  /**
   * Initialize metrics tracking for a new extraction
   */
  initializeExtraction(
    runId: string,
    videoId: string,
    sourceType: 'news' | 'debate' | 'dev'
  ): void {
    const metrics: ExtractionMetrics = {
      runId,
      sourceType,
      videoId,
      timestamp: new Date(),
      totalChunks: 0,
      totalItemsExtracted: 0,
      validationFailures: 0,
      hallucinationsDetected: 0,
      retriesAttempted: 0,
      retriesSuccessful: 0,
      averageConfidence: 0,
      confidenceDistribution: { high: 0, medium: 0, low: 0 },
      validationErrors: [],
      validationWarnings: [],
      tokensUsed: 0,
      estimatedCost: 0,
      processingTimeMs: 0
    };

    this.sessionMetrics.set(videoId, metrics);
  }

  /**
   * Record chunk processing
   */
  recordChunkProcessed(videoId: string): void {
    const metrics = this.sessionMetrics.get(videoId);
    if (metrics) {
      metrics.totalChunks++;
    }
  }

  /**
   * Record items extracted
   */
  recordItemsExtracted(
    videoId: string,
    items: any[],
    tokensUsed: number,
    cost: number
  ): void {
    const metrics = this.sessionMetrics.get(videoId);
    if (!metrics) return;

    metrics.totalItemsExtracted += items.length;
    metrics.tokensUsed += tokensUsed;
    metrics.estimatedCost += cost;

    // Update confidence distribution
    for (const item of items) {
      const confidence = item.confidence as 'high' | 'medium' | 'low';
      if (confidence && metrics.confidenceDistribution[confidence] !== undefined) {
        metrics.confidenceDistribution[confidence]++;
      }
    }

    // Calculate average confidence
    const totalItems = metrics.totalItemsExtracted;
    if (totalItems > 0) {
      const confidenceValues = {
        high: 3,
        medium: 2,
        low: 1
      };

      const weightedSum =
        metrics.confidenceDistribution.high * confidenceValues.high +
        metrics.confidenceDistribution.medium * confidenceValues.medium +
        metrics.confidenceDistribution.low * confidenceValues.low;

      metrics.averageConfidence = weightedSum / totalItems;
    }
  }

  /**
   * Record validation failure
   */
  recordValidationFailure(
    videoId: string,
    errors: string[],
    warnings: string[]
  ): void {
    const metrics = this.sessionMetrics.get(videoId);
    if (!metrics) return;

    metrics.validationFailures++;
    metrics.validationErrors.push(...errors);
    metrics.validationWarnings.push(...warnings);
  }

  /**
   * Record hallucination detected
   */
  recordHallucination(videoId: string, hallucinationCount: number): void {
    const metrics = this.sessionMetrics.get(videoId);
    if (metrics) {
      metrics.hallucinationsDetected += hallucinationCount;
    }
  }

  /**
   * Record retry attempt
   */
  recordRetry(videoId: string, successful: boolean): void {
    const metrics = this.sessionMetrics.get(videoId);
    if (!metrics) return;

    metrics.retriesAttempted++;
    if (successful) {
      metrics.retriesSuccessful++;
    }
  }

  /**
   * Finalize extraction and save to database
   */
  async finalizeExtraction(videoId: string, processingTimeMs: number): Promise<void> {
    const metrics = this.sessionMetrics.get(videoId);
    if (!metrics) return;

    metrics.processingTimeMs = processingTimeMs;

    // Save to database
    await this.saveMetrics(metrics);

    // Clean up session
    this.sessionMetrics.delete(videoId);
  }

  /**
   * Save metrics to database
   */
  private async saveMetrics(metrics: ExtractionMetrics): Promise<void> {
    try {
      await this.db.run(`
        INSERT INTO llm_extraction_metrics (
          run_id, source_type, video_id, timestamp,
          total_chunks, total_items_extracted, validation_failures,
          hallucinations_detected, retries_attempted, retries_successful,
          average_confidence, confidence_distribution,
          validation_errors, validation_warnings,
          tokens_used, estimated_cost, processing_time_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        metrics.runId,
        metrics.sourceType,
        metrics.videoId,
        metrics.timestamp.toISOString(),
        metrics.totalChunks,
        metrics.totalItemsExtracted,
        metrics.validationFailures,
        metrics.hallucinationsDetected,
        metrics.retriesAttempted,
        metrics.retriesSuccessful,
        metrics.averageConfidence,
        JSON.stringify(metrics.confidenceDistribution),
        JSON.stringify(metrics.validationErrors),
        JSON.stringify(metrics.validationWarnings),
        metrics.tokensUsed,
        metrics.estimatedCost,
        metrics.processingTimeMs
      ]);
    } catch (error) {
      console.error('Failed to save LLM metrics:', error);
    }
  }

  /**
   * Get aggregated metrics for a time period
   */
  async getAggregatedMetrics(
    startDate: Date,
    endDate: Date
  ): Promise<AggregatedMetrics> {
    const rows = await this.db.query(`
      SELECT
        source_type,
        COUNT(*) as count,
        AVG(average_confidence) as avg_confidence,
        SUM(hallucinations_detected) as total_hallucinations,
        SUM(total_items_extracted) as total_items,
        SUM(validation_failures) as total_failures,
        SUM(retries_attempted) as total_retries,
        SUM(retries_successful) as successful_retries,
        SUM(estimated_cost) as total_cost
      FROM llm_extraction_metrics
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY source_type
    `, [startDate.toISOString(), endDate.toISOString()]);

    const bySourceType: any = {
      news: { count: 0, avgConfidence: 0, hallucinationRate: 0, avgItemsExtracted: 0 },
      debate: { count: 0, avgConfidence: 0, hallucinationRate: 0, avgItemsExtracted: 0 },
      dev: { count: 0, avgConfidence: 0, hallucinationRate: 0, avgItemsExtracted: 0 }
    };

    let totalExtractions = 0;
    let totalHallucinations = 0;
    let totalItems = 0;
    let totalFailures = 0;
    let totalRetries = 0;
    let successfulRetries = 0;
    let totalCost = 0;

    for (const row of rows) {
      const sourceType = row.source_type as 'news' | 'debate' | 'dev';

      bySourceType[sourceType] = {
        count: row.count,
        avgConfidence: row.avg_confidence,
        hallucinationRate: row.count > 0 ? row.total_hallucinations / row.total_items : 0,
        avgItemsExtracted: row.count > 0 ? row.total_items / row.count : 0
      };

      totalExtractions += row.count;
      totalHallucinations += row.total_hallucinations;
      totalItems += row.total_items;
      totalFailures += row.total_failures;
      totalRetries += row.total_retries;
      successfulRetries += row.successful_retries;
      totalCost += row.total_cost;
    }

    return {
      totalExtractions,
      successRate: totalExtractions > 0 ? 1 - (totalFailures / totalExtractions) : 1,
      hallucinationRate: totalItems > 0 ? totalHallucinations / totalItems : 0,
      retrySuccessRate: totalRetries > 0 ? successfulRetries / totalRetries : 0,
      averageItemsPerVideo: totalExtractions > 0 ? totalItems / totalExtractions : 0,
      averageConfidence: rows.length > 0 ?
        rows.reduce((sum, r) => sum + r.avg_confidence, 0) / rows.length : 0,
      totalCost,
      bySourceType,
      startDate,
      endDate
    };
  }

  /**
   * Get quality report (human-readable summary)
   */
  async getQualityReport(days: number = 7): Promise<string> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const metrics = await this.getAggregatedMetrics(startDate, endDate);

    return `
📊 LLM EXTRACTION QUALITY REPORT (Last ${days} days)
=====================================================

Overall Performance:
  - Total Extractions: ${metrics.totalExtractions}
  - Success Rate: ${(metrics.successRate * 100).toFixed(1)}%
  - Hallucination Rate: ${(metrics.hallucinationRate * 100).toFixed(2)}%
  - Retry Success Rate: ${(metrics.retrySuccessRate * 100).toFixed(1)}%
  - Avg Items/Video: ${metrics.averageItemsPerVideo.toFixed(1)}
  - Avg Confidence: ${metrics.averageConfidence.toFixed(2)}/3.0
  - Total Cost: $${metrics.totalCost.toFixed(4)}

By Source Type:
  📰 News:
     - Extractions: ${metrics.bySourceType.news.count}
     - Avg Confidence: ${metrics.bySourceType.news.avgConfidence.toFixed(2)}
     - Hallucination Rate: ${(metrics.bySourceType.news.hallucinationRate * 100).toFixed(2)}%
     - Avg Items: ${metrics.bySourceType.news.avgItemsExtracted.toFixed(1)}

  🧠 Debate:
     - Extractions: ${metrics.bySourceType.debate.count}
     - Avg Confidence: ${metrics.bySourceType.debate.avgConfidence.toFixed(2)}
     - Hallucination Rate: ${(metrics.bySourceType.debate.hallucinationRate * 100).toFixed(2)}%
     - Avg Items: ${metrics.bySourceType.debate.avgItemsExtracted.toFixed(1)}

  🛠️ Dev:
     - Extractions: ${metrics.bySourceType.dev.count}
     - Avg Confidence: ${metrics.bySourceType.dev.avgConfidence.toFixed(2)}
     - Hallucination Rate: ${(metrics.bySourceType.dev.hallucinationRate * 100).toFixed(2)}%
     - Avg Items: ${metrics.bySourceType.dev.avgItemsExtracted.toFixed(1)}

🎯 Quality Indicators:
  ${metrics.hallucinationRate < 0.05 ? '✅' : '❌'} Hallucination Rate < 5%
  ${metrics.successRate > 0.9 ? '✅' : '❌'} Success Rate > 90%
  ${metrics.retrySuccessRate > 0.7 ? '✅' : '❌'} Retry Success > 70%
  ${metrics.averageConfidence >= 2.0 ? '✅' : '❌'} Avg Confidence >= 2.0 (medium)
`;
  }

  /**
   * Create database table for metrics if not exists
   */
  async ensureMetricsTable(): Promise<void> {
    await this.db.run(`
      CREATE TABLE IF NOT EXISTS llm_extraction_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        video_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        total_chunks INTEGER NOT NULL,
        total_items_extracted INTEGER NOT NULL,
        validation_failures INTEGER NOT NULL,
        hallucinations_detected INTEGER NOT NULL,
        retries_attempted INTEGER NOT NULL,
        retries_successful INTEGER NOT NULL,
        average_confidence REAL NOT NULL,
        confidence_distribution TEXT NOT NULL,
        validation_errors TEXT NOT NULL,
        validation_warnings TEXT NOT NULL,
        tokens_used INTEGER NOT NULL,
        estimated_cost REAL NOT NULL,
        processing_time_ms INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_llm_metrics_timestamp
      ON llm_extraction_metrics(timestamp)
    `);

    await this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_llm_metrics_run_id
      ON llm_extraction_metrics(run_id)
    `);
  }
}

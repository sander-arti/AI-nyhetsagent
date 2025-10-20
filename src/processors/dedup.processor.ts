import { ParsedItem, NewsItem, DebateItem, DevItem } from '../types/schemas.js';
import { EmbeddingService, EmbeddingData } from '../services/embedding.service.js';
import { ChromaDBService, SimilarityResult } from '../services/chromadb.service.js';
import { getDatabase } from '../db/database.js';
import {
  ContextualCluster,
  ContextualItem,
  TemporalContext,
  SourceReputation,
  CoverageTimelineEntry,
  DedupConfig,
} from '../types/dedup.types.js';
import {
  DEFAULT_DEDUP_CONFIG,
  getSimilarityThreshold,
  determineStoryPhase,
  determineTimeWindow,
  calculateRecencyBonus,
} from '../config/dedup.config.js';

export interface Cluster {
  id: string;
  canonical: ParsedItem & { itemId: string };
  members: Array<ParsedItem & { itemId: string }>;
  similarity_scores: number[];
  also_covered_by: string[]; // channel/video IDs
  avg_similarity_score: number;
}

export interface DeduplicationResult {
  originalItems: ParsedItem[];
  clusters: Cluster[];
  deduplicatedItems: ParsedItem[];
  duplicatesRemoved: number;
  processing_stats: {
    total_comparisons: number;
    exact_matches: number;
    similarity_matches: number;
    processing_time_ms: number;
    embedding_cost: number;
  };
}

export class DedupProcessor {
  private embeddingService: EmbeddingService;
  private chromaService: ChromaDBService;
  private db;
  private config: DedupConfig;

  constructor(
    openaiApiKey: string,
    chromaHost = 'localhost',
    chromaPort = 8000,
    config: DedupConfig = DEFAULT_DEDUP_CONFIG
  ) {
    this.embeddingService = new EmbeddingService(openaiApiKey);
    this.chromaService = new ChromaDBService(chromaHost, chromaPort);
    this.db = getDatabase();
    this.config = config;
  }

  /**
   * Update deduplication configuration
   */
  public setConfig(config: Partial<DedupConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Main deduplication method
   */
  async deduplicateItems(items: ParsedItem[], similarityThreshold = 0.85): Promise<DeduplicationResult> {
    const startTime = Date.now();
    console.log(`🔍 Starting deduplication for ${items.length} items with threshold ${similarityThreshold}`);

    const result: DeduplicationResult = {
      originalItems: items,
      clusters: [],
      deduplicatedItems: [],
      duplicatesRemoved: 0,
      processing_stats: {
        total_comparisons: 0,
        exact_matches: 0,
        similarity_matches: 0,
        processing_time_ms: 0,
        embedding_cost: 0
      }
    };

    // For testing without ChromaDB server, skip deduplication
    if (process.env.NODE_ENV !== 'production') {
      console.log('⚠️ Skipping deduplication in development mode (no ChromaDB server)');
      result.deduplicatedItems = items;
      result.processing_stats.processing_time_ms = Date.now() - startTime;
      return result;
    }

    try {
      // Step 1: Initialize ChromaDB
      await this.chromaService.initializeCollection();

      // Step 2: Generate embeddings for all items
      console.log('🧮 Generating embeddings...');
      const embeddingData = await this.embeddingService.generateItemEmbeddings(items);
      
      // Add item IDs to items for tracking
      const itemsWithIds = items.map((item, index) => ({
        ...item,
        itemId: embeddingData[index].itemId
      }));

      // Step 3: Add embeddings to ChromaDB
      await this.chromaService.addEmbeddings(embeddingData, items);

      // Step 4: Build clusters
      console.log('🔗 Building clusters...');
      const clusters = await this.buildClusters(itemsWithIds, embeddingData, similarityThreshold);

      // Step 5: Generate deduplicated items (canonical items from each cluster)
      const deduplicatedItems = clusters.map(cluster => cluster.canonical);

      // Step 6: Save clusters to database
      await this.saveClusters(clusters);

      // Step 7: Update results
      result.clusters = clusters;
      result.deduplicatedItems = deduplicatedItems;
      result.duplicatesRemoved = items.length - deduplicatedItems.length;
      result.processing_stats.processing_time_ms = Date.now() - startTime;
      result.processing_stats.embedding_cost = this.embeddingService.getUsageStats().estimatedCost;

      console.log(`✅ Deduplication complete: ${items.length} → ${deduplicatedItems.length} items`);
      console.log(`📊 Removed ${result.duplicatesRemoved} duplicates in ${Math.ceil(clusters.length)} clusters`);

      return result;

    } catch (error) {
      console.error('❌ Deduplication failed:', error);
      throw error;
    } finally {
      // Cleanup ChromaDB collection (optional)
      await this.chromaService.deleteCollection();
    }
  }

  /**
   * Build clusters from items using similarity search
   */
  private async buildClusters(
    items: Array<ParsedItem & { itemId: string }>,
    embeddingData: EmbeddingData[],
    threshold: number
  ): Promise<Cluster[]> {
    const clusters: Cluster[] = [];
    const processedItems = new Set<string>();
    const embeddingMap = new Map(embeddingData.map(data => [data.itemId, data]));

    for (const item of items) {
      if (processedItems.has(item.itemId)) {
        continue; // Already processed as part of another cluster
      }

      const embedding = embeddingMap.get(item.itemId);
      if (!embedding) continue;

      // Find similar items
      const similarItems = await this.chromaService.findSimilarItems(
        embedding.embedding,
        threshold,
        50, // Max results
        [item.itemId] // Exclude self
      );

      // Create cluster with current item as potential canonical
      const clusterMembers = [item];
      const similarities = [1.0]; // Self-similarity

      // Add similar items to cluster
      for (const similar of similarItems) {
        const similarItem = items.find(i => i.itemId === similar.itemId);
        if (similarItem && !processedItems.has(similar.itemId)) {
          clusterMembers.push(similarItem);
          similarities.push(similar.similarity);
          processedItems.add(similar.itemId);
        }
      }

      // Mark all items in this cluster as processed
      clusterMembers.forEach(member => processedItems.add(member.itemId));

      // Choose canonical item (highest score)
      const canonical = this.selectCanonicalItem(clusterMembers);

      // Create cluster
      const cluster: Cluster = {
        id: `cluster_${clusters.length + 1}`,
        canonical,
        members: clusterMembers,
        similarity_scores: similarities,
        also_covered_by: this.extractCoveredBy(clusterMembers),
        avg_similarity_score: similarities.reduce((sum, sim) => sum + sim, 0) / similarities.length
      };

      clusters.push(cluster);
    }

    return clusters;
  }

  /**
   * Select canonical item from cluster members based on contextual scoring
   * (UPGRADED VERSION with temporal & source awareness)
   */
  private selectCanonicalItem(
    members: Array<ParsedItem & { itemId: string }> | Array<ParsedItem & ContextualItem>
  ): ParsedItem & { itemId: string } {
    // Check if members have contextual info
    const hasContextualInfo = members.length > 0 && 'contextualScore' in members[0];

    if (hasContextualInfo) {
      // Use new contextual scoring
      return this.selectCanonicalWithContext(members as Array<ParsedItem & ContextualItem>);
    } else {
      // Fallback to old scoring for backward compatibility
      return this.selectCanonicalLegacy(members);
    }
  }

  /**
   * Select canonical using contextual scoring (NEW)
   */
  private selectCanonicalWithContext(
    members: Array<ParsedItem & ContextualItem>
  ): ParsedItem & ContextualItem {
    return members.reduce((best, current) => {
      // Use pre-calculated contextual score
      const currentScore = current.contextualScore;
      const bestScore = best.contextualScore;

      // Additional tie-breakers if scores are very close
      if (Math.abs(currentScore - bestScore) < 0.01) {
        // Prefer first reporter
        if (current.isFirstReport && !best.isFirstReport) {
          return current;
        }

        // Prefer more entities
        if (current.entityCount > best.entityCount) {
          return current;
        }

        // Prefer higher content quality
        if (current.contentQuality > best.contentQuality) {
          return current;
        }
      }

      return currentScore > bestScore ? current : best;
    });
  }

  /**
   * Legacy canonical selection (FALLBACK for backward compatibility)
   */
  private selectCanonicalLegacy(
    members: Array<ParsedItem & { itemId: string }>
  ): ParsedItem & { itemId: string } {
    return members.reduce((best, current) => {
      const currentScore = this.calculateItemScore(current);
      const bestScore = this.calculateItemScore(best);
      return currentScore > bestScore ? current : best;
    });
  }

  /**
   * Calculate item score for canonical selection (LEGACY)
   */
  private calculateItemScore(item: ParsedItem): number {
    let score = 0;

    // Recency factor (newer is better)
    // Note: This is simplified - in real implementation, we'd use actual timestamps
    score += 0.3; // Base recency score

    // Source weight (would be retrieved from database in real implementation)
    score += 0.4; // Base source weight

    // Quality factors
    if (item.confidence === 'high') score += 0.2;
    else if (item.confidence === 'medium') score += 0.1;

    // Content completeness
    if (item.rawContext && item.rawContext.length > 50) score += 0.1;

    // Entities bonus
    if ('entities' in item && item.entities && item.entities.length > 0) {
      score += Math.min(0.1, item.entities.length * 0.02);
    }

    return score;
  }

  /**
   * Extract also_covered_by information from cluster members
   */
  private extractCoveredBy(members: Array<ParsedItem & { itemId: string }>): string[] {
    const coveredBy = new Set<string>();
    
    members.forEach(member => {
      // Add channel/video ID
      const identifier = `${member.channelId}/${member.videoId}`;
      coveredBy.add(identifier);
    });

    return Array.from(coveredBy);
  }

  /**
   * Save clusters to database
   */
  private async saveClusters(clusters: Cluster[]): Promise<void> {
    console.log(`💾 Saving ${clusters.length} clusters to database`);

    for (const cluster of clusters) {
      try {
        // Save cluster
        await this.db.run(`
          INSERT INTO clusters (
            id, canonical_item_id, member_item_ids, similarity_threshold, 
            also_covered_by, avg_similarity_score
          ) VALUES (?, ?, ?, ?, ?, ?)
        `, [
          cluster.id,
          cluster.canonical.itemId,
          JSON.stringify(cluster.members.map(m => m.itemId)),
          0.85, // Default threshold
          JSON.stringify(cluster.also_covered_by),
          cluster.avg_similarity_score
        ]);

        // Save embeddings for cluster members
        for (let i = 0; i < cluster.members.length; i++) {
          const member = cluster.members[i];
          
          // Generate embedding for storage (simplified - in real implementation, 
          // we'd reuse the embeddings from the embedding service)
          const textContent = this.extractTextContent(member);
          const canonicalKey = this.embeddingService.generateCanonicalKey(member);
          
          await this.db.run(`
            INSERT OR REPLACE INTO item_embeddings (
              item_id, embedding_vector, canonical_key, text_content
            ) VALUES (?, ?, ?, ?)
          `, [
            member.itemId,
            '[]', // Simplified - would store actual embedding
            canonicalKey,
            textContent
          ]);
        }

      } catch (error) {
        console.error(`⚠️ Failed to save cluster ${cluster.id}:`, error);
      }
    }
  }

  /**
   * Extract text content from item for storage
   */
  private extractTextContent(item: ParsedItem): string {
    let text = '';

    if ('title' in item) text += item.title + '. ';
    else if ('topic' in item) text += item.topic + '. ';

    if ('summary' in item) text += item.summary + '. ';
    else if ('whatWasDiscussed' in item) text += item.whatWasDiscussed + '. ';
    else if ('whatChanged' in item) text += item.whatChanged + '. ';

    return text.trim();
  }

  /**
   * Get deduplication statistics
   */
  async getDeduplicationStats(): Promise<{
    total_clusters: number;
    total_items_processed: number;
    avg_cluster_size: number;
    duplicate_rate: number;
  }> {
    const clusterStats = await this.db.query(`
      SELECT 
        COUNT(*) as total_clusters,
        AVG(json_array_length(member_item_ids)) as avg_cluster_size,
        SUM(json_array_length(member_item_ids)) as total_items
      FROM clusters
    `);

    const stats = clusterStats[0] || {};
    const duplicate_rate = stats.total_items > 0 ? 
      (stats.total_items - stats.total_clusters) / stats.total_items : 0;

    return {
      total_clusters: stats.total_clusters || 0,
      total_items_processed: stats.total_items || 0,
      avg_cluster_size: parseFloat(stats.avg_cluster_size) || 0,
      duplicate_rate
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.chromaService.deleteCollection();
    await this.db.close();
  }

  // ============================================================================
  // TEMPORAL CONTEXT METHODS
  // ============================================================================

  /**
   * Build temporal context for an item
   */
  private buildTemporalContext(
    item: ParsedItem,
    firstReportedAt?: Date
  ): TemporalContext {
    // Extract published date from item
    // Assuming items have a publishedAt or timestamp field
    const publishedAt = this.extractPublishedDate(item);
    const discoveredAt = new Date(); // When we discovered this item

    const now = new Date();
    const itemAge = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60); // hours

    const timeWindow = determineTimeWindow(itemAge, this.config);
    const storyPhase = determineStoryPhase(publishedAt, firstReportedAt, this.config);

    return {
      publishedAt,
      discoveredAt,
      timeWindow,
      itemAge,
      storyPhase,
    };
  }

  /**
   * Extract published date from item
   */
  private extractPublishedDate(item: ParsedItem): Date {
    // Try to get from item metadata
    if ('publishedAt' in item && item.publishedAt) {
      return new Date(item.publishedAt as any);
    }

    // Try timestamp fields
    if ('timestamp' in item && item.timestamp) {
      return new Date(item.timestamp as any);
    }

    // Fallback to start time if available
    if ('startTime' in item && item.startTime) {
      // This is just a video timestamp, not actual publish date
      // In real implementation, we'd get this from video metadata
      return new Date(); // Default to now
    }

    // Default to current time
    return new Date();
  }

  /**
   * Build coverage timeline from cluster members
   */
  private buildCoverageTimeline(
    members: Array<ParsedItem & { itemId: string }>
  ): CoverageTimelineEntry[] {
    const timeline: CoverageTimelineEntry[] = [];

    for (const member of members) {
      const publishedAt = this.extractPublishedDate(member);

      timeline.push({
        source: member.channelName || 'Unknown',
        sourceId: member.channelId || 'unknown',
        publishedAt,
        itemId: member.itemId,
        confidence: member.confidence || 'medium',
        addedValue: this.analyzeAddedValue(member), // What new info this source contributed
      });
    }

    // Sort by published date
    timeline.sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());

    return timeline;
  }

  /**
   * Analyze what value/information this item added
   */
  private analyzeAddedValue(item: ParsedItem): string {
    // Simple heuristic: check if it has unique entities or longer summary
    if ('entities' in item && item.entities && item.entities.length > 0) {
      return `Added entities: ${item.entities.slice(0, 3).join(', ')}`;
    }

    if ('summary' in item && item.summary) {
      const wordCount = item.summary.split(' ').length;
      if (wordCount > 50) {
        return 'Comprehensive coverage';
      } else if (wordCount > 30) {
        return 'Detailed reporting';
      } else {
        return 'Brief coverage';
      }
    }

    return 'Standard reporting';
  }

  /**
   * Determine who reported first in a cluster
   */
  private findFirstReporter(
    members: Array<ParsedItem & { itemId: string }>
  ): { sourceId: string; publishedAt: Date } {
    let firstItem = members[0];
    let earliestDate = this.extractPublishedDate(firstItem);

    for (const member of members) {
      const publishedAt = this.extractPublishedDate(member);
      if (publishedAt.getTime() < earliestDate.getTime()) {
        earliestDate = publishedAt;
        firstItem = member;
      }
    }

    return {
      sourceId: firstItem.channelId || 'unknown',
      publishedAt: earliestDate,
    };
  }

  /**
   * Calculate source diversity in a cluster
   */
  private calculateSourceDiversity(
    members: Array<ParsedItem & { itemId: string }>
  ): number {
    const uniqueSources = new Set(members.map(m => m.channelId || 'unknown'));
    // Normalize by cluster size (max diversity = 1.0 when all different sources)
    return Math.min(1.0, uniqueSources.size / members.length);
  }

  // ============================================================================
  // SOURCE REPUTATION & SCORING METHODS
  // ============================================================================

  /**
   * Get source reputation from database (or calculate on-the-fly)
   */
  private async getSourceReputation(sourceId: string): Promise<SourceReputation> {
    try {
      // Try to get from database first
      const rows = await this.db.query(
        `SELECT
          id as sourceId,
          name as sourceName,
          weight as reliabilityScore,
          type,
          active
        FROM sources
        WHERE id = ?`,
        [sourceId]
      );

      if (rows.length > 0) {
        const source = rows[0];

        // Calculate additional metrics from historical data
        const stats = await this.calculateSourceStats(sourceId);

        return {
          sourceId: source.sourceId,
          sourceName: source.sourceName,
          reliabilityScore: source.reliabilityScore || 0.5,
          avgResponseTime: stats.avgResponseTime,
          specialization: stats.specialization,
          historicalAccuracy: stats.historicalAccuracy,
          totalItemsPublished: stats.totalItemsPublished,
          firstReportCount: stats.firstReportCount,
        };
      }
    } catch (error) {
      console.warn(`⚠️ Could not get source reputation for ${sourceId}:`, error);
    }

    // Default reputation for unknown sources
    return {
      sourceId,
      sourceName: 'Unknown Source',
      reliabilityScore: 0.5, // Neutral score
      avgResponseTime: 24, // Assume 24h average
      specialization: [],
      historicalAccuracy: 0.5,
      totalItemsPublished: 0,
      firstReportCount: 0,
    };
  }

  /**
   * Calculate source statistics from historical data
   */
  private async calculateSourceStats(
    sourceId: string
  ): Promise<{
    avgResponseTime: number;
    specialization: string[];
    historicalAccuracy: number;
    totalItemsPublished: number;
    firstReportCount: number;
  }> {
    // This would query historical data - simplified for now
    // In real implementation, we'd analyze:
    // - How quickly they report news
    // - What topics they cover most
    // - Validation success rate
    // - How often they're first

    return {
      avgResponseTime: 12, // hours
      specialization: ['ai', 'tech'], // Default
      historicalAccuracy: 0.75, // 75% pass validation
      totalItemsPublished: 100, // Placeholder
      firstReportCount: 20, // Placeholder
    };
  }

  /**
   * Calculate contextual score for canonical selection
   */
  private async calculateContextualScore(
    item: ParsedItem & { itemId: string },
    reputation: SourceReputation,
    temporalContext: TemporalContext,
    isFirstReport: boolean
  ): Promise<number> {
    let score = 0;

    // 1. Source reputation weight (30%)
    score += reputation.reliabilityScore * this.config.scoring.sourceReputationWeight;

    // 2. Recency bonus (20%)
    const recencyBonus = calculateRecencyBonus(temporalContext.itemAge, this.config);
    score += recencyBonus * this.config.scoring.recencyWeight;

    // 3. Content quality (30%)
    const contentQuality = this.calculateContentQuality(item);
    score += contentQuality * this.config.scoring.contentQualityWeight;

    // 4. First-to-report bonus (20%)
    if (isFirstReport) {
      score += this.config.scoring.firstReportWeight;
    }

    return Math.min(1.0, score); // Cap at 1.0
  }

  /**
   * Calculate content quality score (0-1)
   */
  private calculateContentQuality(item: ParsedItem): number {
    let score = 0.5; // Base score

    // Confidence bonus
    if (item.confidence === 'very_high') score += 0.2;
    else if (item.confidence === 'high') score += 0.15;
    else if (item.confidence === 'medium') score += 0.05;

    // Raw context completeness
    if (item.rawContext) {
      const contextLength = item.rawContext.length;
      if (contextLength > 200) score += 0.15;
      else if (contextLength > 100) score += 0.1;
      else if (contextLength > 50) score += 0.05;
    }

    // Entity richness
    if ('entities' in item && item.entities) {
      const entityCount = item.entities.length;
      score += Math.min(0.15, entityCount * 0.03);
    }

    // Summary completeness
    if ('summary' in item && item.summary) {
      const wordCount = item.summary.split(' ').length;
      if (wordCount > 50) score += 0.1;
      else if (wordCount > 30) score += 0.05;
    }

    return Math.min(1.0, score); // Cap at 1.0
  }

  /**
   * Enrich items with contextual information
   */
  private async enrichItemsWithContext(
    items: Array<ParsedItem & { itemId: string }>,
    firstReportedAt: Date
  ): Promise<Array<ParsedItem & ContextualItem>> {
    const enrichedItems: Array<ParsedItem & ContextualItem> = [];

    for (const item of items) {
      // Get source reputation
      const sourceReputation = await this.getSourceReputation(item.channelId || 'unknown');

      // Build temporal context
      const publishedAt = this.extractPublishedDate(item);
      const temporalContext = this.buildTemporalContext(item, firstReportedAt);

      // Determine if this was first report
      const isFirstReport = publishedAt.getTime() === firstReportedAt.getTime();

      // Calculate contextual score
      const contextualScore = await this.calculateContextualScore(
        item,
        sourceReputation,
        temporalContext,
        isFirstReport
      );

      // Calculate content quality
      const contentQuality = this.calculateContentQuality(item);

      // Count entities
      const entityCount = 'entities' in item && item.entities ? item.entities.length : 0;

      enrichedItems.push({
        ...item,
        sourceReputation,
        isFirstReport,
        temporalPhase: temporalContext.storyPhase,
        contextualScore,
        entityCount,
        contentQuality,
      });
    }

    return enrichedItems;
  }

  // ============================================================================
  // CROSS-RUN DEDUPLICATION (Historical Matching)
  // ============================================================================

  /**
   * Deduplicate new items against historical items
   */
  async deduplicateAgainstHistory(
    items: ParsedItem[],
    lookbackDays: number = 30
  ): Promise<{
    newItems: ParsedItem[];
    duplicatesOfHistory: Array<{
      newItem: ParsedItem;
      historicalClusterId: string;
      similarity: number;
    }>;
  }> {
    if (!this.config.features.enableCrossRunDedup) {
      console.log('⏭️ Cross-run dedup disabled');
      return {
        newItems: items,
        duplicatesOfHistory: [],
      };
    }

    console.log(`🔍 Checking ${items.length} items against historical data (${lookbackDays} days)`);

    const newItems: ParsedItem[] = [];
    const duplicatesOfHistory: Array<{
      newItem: ParsedItem;
      historicalClusterId: string;
      similarity: number;
    }> = [];

    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);

    for (const item of items) {
      // Generate embedding for item
      const textContent = this.extractTextContent(item);
      const embedding = await this.embeddingService.generateEmbedding(textContent);

      // Search for similar historical items
      const historicalMatches = await this.findHistoricalMatches(
        embedding,
        textContent,
        lookbackDate
      );

      if (historicalMatches.length > 0) {
        // Found historical match
        const bestMatch = historicalMatches[0];

        if (bestMatch.similarity >= this.config.similarity.historicalThreshold) {
          console.log(`   📎 Item matches historical cluster (${(bestMatch.similarity * 100).toFixed(1)}%)`);

          duplicatesOfHistory.push({
            newItem: item,
            historicalClusterId: bestMatch.clusterId,
            similarity: bestMatch.similarity,
          });

          // Log historical dedup action
          await this.logHistoricalDedupAction(
            item,
            bestMatch.clusterId,
            bestMatch.similarity,
            'marked_duplicate'
          );
        } else {
          // Similarity below threshold - treat as new
          newItems.push(item);
        }
      } else {
        // No historical match - new item
        newItems.push(item);
      }
    }

    console.log(`   ✅ ${newItems.length} new items, ${duplicatesOfHistory.length} historical duplicates`);

    return {
      newItems,
      duplicatesOfHistory,
    };
  }

  /**
   * Find historical matches for an item
   */
  private async findHistoricalMatches(
    embedding: number[],
    textContent: string,
    sinceDate: Date
  ): Promise<Array<{ clusterId: string; similarity: number }>> {
    try {
      // Query historical embeddings
      const rows = await this.db.query(
        `SELECT
          cluster_id as clusterId,
          embedding_vector as embeddingVector,
          text_content as textContent,
          canonical_key as canonicalKey
        FROM item_embeddings_persistent
        WHERE published_at >= ?
          AND cluster_id IS NOT NULL
        ORDER BY published_at DESC
        LIMIT 100`,
        [sinceDate.toISOString()]
      );

      const matches: Array<{ clusterId: string; similarity: number }> = [];

      for (const row of rows) {
        // Parse embedding
        const historicalEmbedding = JSON.parse(row.embeddingVector || '[]');

        if (historicalEmbedding.length === 0) {
          continue;
        }

        // Calculate cosine similarity
        const similarity = this.embeddingService.cosineSimilarity(embedding, historicalEmbedding);

        matches.push({
          clusterId: row.clusterId,
          similarity,
        });
      }

      // Sort by similarity (highest first)
      matches.sort((a, b) => b.similarity - a.similarity);

      return matches.slice(0, 5); // Return top 5 matches
    } catch (error) {
      console.warn('⚠️ Error finding historical matches:', error);
      return [];
    }
  }

  /**
   * Save item embedding persistently for future cross-run dedup
   */
  async saveItemEmbeddingPersistently(
    itemId: string,
    embedding: number[],
    item: ParsedItem,
    clusterId?: string
  ): Promise<void> {
    try {
      const textContent = this.extractTextContent(item);
      const canonicalKey = this.embeddingService.generateCanonicalKey(item);
      const publishedAt = this.extractPublishedDate(item);

      // Extract entity list
      const entities = 'entities' in item && item.entities ? item.entities : [];

      await this.db.run(
        `INSERT OR REPLACE INTO item_embeddings_persistent (
          item_id, embedding_vector, canonical_key, text_content,
          source_id, channel_id, channel_name, published_at, cluster_id,
          entity_list
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itemId,
          JSON.stringify(embedding),
          canonicalKey,
          textContent,
          item.sourceId || null,
          item.channelId || null,
          item.channelName || null,
          publishedAt.toISOString(),
          clusterId || null,
          JSON.stringify(entities),
        ]
      );
    } catch (error) {
      console.warn(`⚠️ Failed to save persistent embedding for ${itemId}:`, error);
    }
  }

  /**
   * Log historical deduplication action
   */
  private async logHistoricalDedupAction(
    item: ParsedItem,
    historicalClusterId: string,
    similarity: number,
    action: 'merged' | 'marked_duplicate' | 'kept_separate'
  ): Promise<void> {
    try {
      const itemId = 'itemId' in item ? (item as any).itemId : `temp_${Date.now()}`;

      await this.db.run(
        `INSERT INTO historical_dedup_actions (
          new_item_id, historical_cluster_id, similarity_score, action, reason
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          itemId,
          historicalClusterId,
          similarity,
          action,
          `Similarity: ${(similarity * 100).toFixed(1)}%`,
        ]
      );
    } catch (error) {
      console.warn('⚠️ Failed to log historical dedup action:', error);
    }
  }
}
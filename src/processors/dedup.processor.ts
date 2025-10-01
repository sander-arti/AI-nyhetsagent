import { ParsedItem, NewsItem, DebateItem, DevItem } from '../types/schemas.js';
import { EmbeddingService, EmbeddingData } from '../services/embedding.service.js';
import { ChromaDBService, SimilarityResult } from '../services/chromadb.service.js';
import { getDatabase } from '../db/database.js';

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

  constructor(openaiApiKey: string, chromaHost = 'localhost', chromaPort = 8000) {
    this.embeddingService = new EmbeddingService(openaiApiKey);
    this.chromaService = new ChromaDBService(chromaHost, chromaPort);
    this.db = getDatabase();
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
   * Select canonical item from cluster members based on scoring
   */
  private selectCanonicalItem(members: Array<ParsedItem & { itemId: string }>): ParsedItem & { itemId: string } {
    return members.reduce((best, current) => {
      const currentScore = this.calculateItemScore(current);
      const bestScore = this.calculateItemScore(best);
      return currentScore > bestScore ? current : best;
    });
  }

  /**
   * Calculate item score for canonical selection
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
}
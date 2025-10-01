import { ChromaClient } from 'chromadb';
import { ParsedItem } from '../types/schemas.js';
import { EmbeddingData } from './embedding.service.js';

export interface SimilarityResult {
  itemId: string;
  similarity: number;
  metadata: Record<string, any>;
}

export class ChromaDBService {
  private client: ChromaClient;
  private collectionName: string;

  constructor(host = 'localhost', port = 8000) {
    // For development/testing, use in-memory database
    // For production, use external ChromaDB server
    if (process.env.NODE_ENV === 'production' && host && port) {
      this.client = new ChromaClient({
        path: `http://${host}:${port}`
      });
    } else {
      // Use in-memory ChromaDB for development/testing
      this.client = new ChromaClient();
    }
    
    // Use timestamp-based collection name for each run
    this.collectionName = `dedup_${Date.now()}`;
  }

  /**
   * Initialize ChromaDB collection for current session
   */
  async initializeCollection(): Promise<void> {
    try {
      console.log(`🗄️ Initializing ChromaDB collection: ${this.collectionName}`);

      // Create collection (will be created if doesn't exist)
      await this.client.createCollection({
        name: this.collectionName,
        metadata: {
          description: 'News item embeddings for deduplication',
          created_at: new Date().toISOString()
        }
      });

      console.log(`✅ ChromaDB collection initialized`);

    } catch (error) {
      console.error('❌ Failed to initialize ChromaDB collection:', error);
      throw error;
    }
  }

  /**
   * Add embeddings to ChromaDB collection
   */
  async addEmbeddings(embeddingData: EmbeddingData[], items: ParsedItem[]): Promise<void> {
    if (embeddingData.length !== items.length) {
      throw new Error('Embedding data and items arrays must have the same length');
    }

    try {
      console.log(`📥 Adding ${embeddingData.length} embeddings to ChromaDB`);

      const collection = await this.client.getCollection({ name: this.collectionName });

      // Prepare data for ChromaDB
      const ids = embeddingData.map(data => data.itemId);
      const embeddings = embeddingData.map(data => data.embedding);
      const metadatas = items.map((item, index) => ({
        videoId: item.videoId,
        channelId: item.channelId,
        confidence: item.confidence,
        canonicalKey: embeddingData[index].canonicalKey,
        textContent: embeddingData[index].textContent,
        title: 'title' in item ? item.title : 'topic' in item ? item.topic : '',
        type: 'type' in item ? item.type : 'changeType' in item ? item.changeType : 'unknown',
        timestamp: item.timestamp || null
      }));
      const documents = embeddingData.map(data => data.textContent);

      await collection.add({
        ids,
        embeddings,
        metadatas,
        documents
      });

      console.log(`✅ Successfully added ${embeddingData.length} embeddings`);

    } catch (error) {
      console.error('❌ Failed to add embeddings to ChromaDB:', error);
      throw error;
    }
  }

  /**
   * Find similar items using embedding similarity
   */
  async findSimilarItems(
    queryEmbedding: number[],
    threshold = 0.85,
    nResults = 10,
    excludeIds: string[] = []
  ): Promise<SimilarityResult[]> {
    try {
      const collection = await this.client.getCollection({ name: this.collectionName });

      const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults,
        where: excludeIds.length > 0 ? { id: { $nin: excludeIds } } : undefined
      });

      if (!results.ids[0] || !results.distances[0] || !results.metadatas[0]) {
        return [];
      }

      // Convert distance to similarity (ChromaDB returns distances, not similarities)
      // For cosine distance: similarity = 1 - distance
      const similarItems: SimilarityResult[] = [];
      
      for (let i = 0; i < results.ids[0].length; i++) {
        const distance = results.distances[0][i];
        const similarity = 1 - distance; // Convert distance to similarity
        
        if (similarity >= threshold) {
          similarItems.push({
            itemId: results.ids[0][i],
            similarity,
            metadata: results.metadatas[0][i] || {}
          });
        }
      }

      return similarItems.sort((a, b) => b.similarity - a.similarity);

    } catch (error) {
      console.error('❌ Failed to find similar items:', error);
      return [];
    }
  }

  /**
   * Find similar items by canonical key (exact matches)
   */
  async findByCanonicalKey(canonicalKey: string): Promise<SimilarityResult[]> {
    try {
      const collection = await this.client.getCollection({ name: this.collectionName });

      const results = await collection.get({
        where: { canonicalKey }
      });

      if (!results.ids || !results.metadatas) {
        return [];
      }

      return results.ids.map((id, index) => ({
        itemId: id,
        similarity: 1.0, // Exact match
        metadata: results.metadatas![index] || {}
      }));

    } catch (error) {
      console.error('❌ Failed to find by canonical key:', error);
      return [];
    }
  }

  /**
   * Get all items in collection
   */
  async getAllItems(): Promise<{ ids: string[]; metadatas: Record<string, any>[] }> {
    try {
      const collection = await this.client.getCollection({ name: this.collectionName });
      
      const results = await collection.get({});
      
      return {
        ids: results.ids || [],
        metadatas: results.metadatas || []
      };

    } catch (error) {
      console.error('❌ Failed to get all items:', error);
      return { ids: [], metadatas: [] };
    }
  }

  /**
   * Clean up old collections (keep only recent ones)
   */
  async cleanupOldCollections(daysToKeep = 7): Promise<void> {
    try {
      console.log(`🧹 Cleaning up ChromaDB collections older than ${daysToKeep} days`);

      const collections = await this.client.listCollections();
      const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

      for (const collection of collections) {
        // Check if collection name contains timestamp and is old enough
        const match = collection.name.match(/dedup_(\d+)/);
        if (match) {
          const timestamp = parseInt(match[1]);
          if (timestamp < cutoffTime) {
            await this.client.deleteCollection({ name: collection.name });
            console.log(`🗑️ Deleted old collection: ${collection.name}`);
          }
        }
      }

    } catch (error) {
      console.error('⚠️ Collection cleanup failed (non-critical):', error);
    }
  }

  /**
   * Delete current collection
   */
  async deleteCollection(): Promise<void> {
    try {
      await this.client.deleteCollection({ name: this.collectionName });
      console.log(`🗑️ Deleted collection: ${this.collectionName}`);
    } catch (error) {
      console.error('⚠️ Failed to delete collection (non-critical):', error);
    }
  }

  /**
   * Get collection statistics
   */
  async getStats(): Promise<{ name: string; count: number }> {
    try {
      const collection = await this.client.getCollection({ name: this.collectionName });
      const count = await collection.count();
      
      return {
        name: this.collectionName,
        count
      };

    } catch (error) {
      console.error('❌ Failed to get collection stats:', error);
      return { name: this.collectionName, count: 0 };
    }
  }

  /**
   * Check if ChromaDB is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.heartbeat();
      return true;
    } catch {
      return false;
    }
  }
}
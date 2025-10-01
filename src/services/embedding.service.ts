import OpenAI from 'openai';
import crypto from 'crypto';
import { NewsItem, DebateItem, DevItem, ParsedItem } from '../types/schemas.js';

export interface EmbeddingData {
  itemId: string;
  embedding: number[];
  canonicalKey: string;
  textContent: string;
}

export class EmbeddingService {
  private openai: OpenAI;
  private totalTokensUsed: number = 0;
  private totalCost: number = 0;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: 'float'
      });

      // Update usage statistics
      this.totalTokensUsed += response.usage.total_tokens;
      // text-embedding-3-small pricing: $0.00002 per 1K tokens
      this.totalCost += (response.usage.total_tokens / 1000) * 0.00002;

      return response.data[0].embedding;

    } catch (error) {
      console.error('❌ Embedding generation failed:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts (batch processing)
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    // OpenAI allows up to 2048 embeddings per request
    const batchSize = 100; // Conservative batch size to avoid timeouts
    const embeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      console.log(`🧮 Generating embeddings for batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}`);

      try {
        const response = await this.openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: batch,
          encoding_format: 'float'
        });

        // Update usage statistics
        this.totalTokensUsed += response.usage.total_tokens;
        this.totalCost += (response.usage.total_tokens / 1000) * 0.00002;

        embeddings.push(...response.data.map(d => d.embedding));

      } catch (error) {
        console.error(`❌ Batch embedding failed for batch ${i}:`, error);
        throw error;
      }

      // Rate limiting delay between batches
      if (i + batchSize < texts.length) {
        await this.delay(500); // 500ms delay
      }
    }

    return embeddings;
  }

  /**
   * Generate embeddings for parsed items
   */
  async generateItemEmbeddings(items: ParsedItem[]): Promise<EmbeddingData[]> {
    const texts = items.map(item => this.extractTextForEmbedding(item));
    const embeddings = await this.generateBatchEmbeddings(texts);

    return items.map((item, index) => ({
      itemId: this.getItemId(item),
      embedding: embeddings[index],
      canonicalKey: this.generateCanonicalKey(item),
      textContent: texts[index]
    }));
  }

  /**
   * Extract relevant text from item for embedding
   */
  private extractTextForEmbedding(item: ParsedItem): string {
    let text = '';

    // Add title/topic
    if ('title' in item) {
      text += item.title + '. ';
    } else if ('topic' in item) {
      text += item.topic + '. ';
    }

    // Add main content
    if ('summary' in item) {
      text += item.summary + '. ';
    } else if ('whatWasDiscussed' in item) {
      text += item.whatWasDiscussed + '. ';
    } else if ('whatChanged' in item) {
      text += item.whatChanged + '. ';
    }

    // Add entities if present
    if ('entities' in item && item.entities && item.entities.length > 0) {
      text += `Entities: ${item.entities.join(', ')}. `;
    }

    // Add affected technologies for dev items
    if ('affectedTechnologies' in item && item.affectedTechnologies && item.affectedTechnologies.length > 0) {
      text += `Technologies: ${item.affectedTechnologies.join(', ')}. `;
    }

    return text.trim();
  }

  /**
   * Generate canonical key for deduplication
   */
  generateCanonicalKey(item: ParsedItem): string {
    let keyParts: string[] = [];

    // Extract entities
    if ('entities' in item && item.entities) {
      keyParts.push(...item.entities.map(e => e.toLowerCase()));
    }

    // Extract normalized title/topic
    const title = 'title' in item ? item.title : 'topic' in item ? item.topic : '';
    if (title) {
      // Simple lemmatization - remove common words and normalize
      const normalized = title
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .split(' ')
        .filter(word => word.length > 2) // Remove short words
        .filter(word => !this.isStopWord(word))
        .sort() // Sort for consistency
        .join('_');
      
      keyParts.push(normalized);
    }

    // Create hash of key parts
    const keyString = keyParts.join('|');
    return crypto.createHash('sha256').update(keyString).digest('hex').substring(0, 16);
  }

  /**
   * Check if word is a stop word
   */
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'will', 'would',
      'this', 'that', 'these', 'those', 'new', 'how', 'why', 'what', 'when', 'where'
    ]);
    return stopWords.has(word);
  }

  /**
   * Get unique ID for item (simplified)
   */
  private getItemId(item: ParsedItem): string {
    return item.videoId + '_' + this.generateCanonicalKey(item);
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Delay utility for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get usage statistics
   */
  getUsageStats(): { tokensUsed: number; estimatedCost: number } {
    return {
      tokensUsed: this.totalTokensUsed,
      estimatedCost: this.totalCost
    };
  }

  /**
   * Reset usage counters
   */
  resetUsage(): void {
    this.totalTokensUsed = 0;
    this.totalCost = 0;
  }
}
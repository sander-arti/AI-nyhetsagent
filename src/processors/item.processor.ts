import { LLMService, ParseRequest } from '../services/llm.service.js';
import { TranscriptProcessor, ProcessedTranscript } from './transcript.processor.js';
import { 
  NewsItem, DebateItem, DevItem, VideoParsingResult, 
  validateItem, calculateConfidenceScore, ConfidenceFactors
} from '../types/schemas.js';
import { getDatabase } from '../db/database.js';

export interface VideoMetadata {
  id: string;
  title: string;
  channelId: string;
  channelName: string;
  duration: number;
  publishedAt: Date;
  url: string;
}

export interface ProcessingOptions {
  maxItemsPerVideo?: number;
  minConfidence?: 'low' | 'medium' | 'high';
  prioritizeRecent?: boolean;
  estimateCosts?: boolean;
}

export class ItemProcessor {
  private llmService: LLMService;
  private db;

  constructor(openaiApiKey: string) {
    this.llmService = new LLMService(openaiApiKey);
    this.db = getDatabase();
  }

  /**
   * Main method: Process video and extract structured items
   */
  async processVideo(
    video: VideoMetadata, 
    transcript: ProcessedTranscript,
    options: ProcessingOptions = {}
  ): Promise<VideoParsingResult> {
    console.log(`🎯 Processing items for: ${video.title}`);
    
    try {
      // Get source information to determine processing type
      const sourceInfo = await this.getSourceInfo(video.channelId);
      if (!sourceInfo) {
        throw new Error(`Source not found for source ID: ${video.channelId}`);
      }

      // Check if already processed
      const existingResult = await this.getExistingItems(video.id);
      if (existingResult) {
        console.log(`✅ Using existing parsed items (${existingResult.totalItems} items)`);
        return existingResult;
      }

      // Create parse request
      const parseRequest: ParseRequest = {
        transcript,
        sourceType: sourceInfo.type,
        videoMetadata: {
          title: video.title,
          channelName: video.channelName,
          duration: video.duration,
          publishedAt: video.publishedAt
        }
      };

      // Parse with LLM
      const llmResult = await this.llmService.parseTranscript(parseRequest);

      // Validate and enhance items
      const processedResult = await this.validateAndEnhanceItems(llmResult, video, sourceInfo);

      // Save to database
      await this.saveItems(processedResult, video.id);

      console.log(`✅ Processed ${processedResult.totalItems} items successfully`);
      return processedResult;

    } catch (error) {
      console.error(`❌ Processing failed for ${video.title}:`, error);
      throw error;
    }
  }

  /**
   * Get source information from database
   */
  private async getSourceInfo(sourceId: string): Promise<{ type: 'news' | 'debate' | 'dev', weight: number, name: string } | null> {
    try {
      // sourceId is actually the internal source ID, not YouTube channel ID
      const rows = await this.db.query(
        'SELECT type, weight, name FROM sources WHERE id = ? AND active = 1',
        [sourceId]
      );
      
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting source info:', error);
      return null;
    }
  }

  /**
   * Check for existing processed items
   */
  private async getExistingItems(videoId: string): Promise<VideoParsingResult | null> {
    try {
      const itemRows = await this.db.query(`
        SELECT i.*, v.duration_seconds, v.title, v.published_at 
        FROM items i
        JOIN videos v ON i.video_id = v.id
        WHERE v.video_id = ?
        ORDER BY i.relevance_score DESC
      `, [videoId]);

      if (itemRows.length === 0) return null;

      // Reconstruct result from database
      const firstRow = itemRows[0];
      const items = itemRows.map(row => ({
        videoId,
        channelId: row.channel_id || '',
        sourceUrl: firstRow.url || `https://www.youtube.com/watch?v=${videoId}`,
        timestamp: row.timestamp_hms,
        confidence: row.confidence as 'high' | 'medium' | 'low',
        rawContext: '', // Not stored in current schema
        title: row.title,
        summary: row.summary,
        entities: JSON.parse(row.entities || '[]'),
        type: row.type,
        qualityScore: row.relevance_score
      }));

      // Group by type (simplified - assumes all items are same type)
      const sourceType = await this.getSourceTypeForVideo(videoId);
      const result: VideoParsingResult = {
        videoId,
        sourceType: sourceType || 'news',
        totalItems: items.length,
        processingTimeMs: 0, // Historical data
      };

      if (sourceType === 'news') result.newsItems = items as NewsItem[];
      else if (sourceType === 'debate') result.debateItems = items as DebateItem[];
      else if (sourceType === 'dev') result.devItems = items as DevItem[];

      return result;

    } catch (error) {
      console.error('Error checking existing items:', error);
      return null;
    }
  }

  /**
   * Get source type for a video
   */
  private async getSourceTypeForVideo(videoId: string): Promise<'news' | 'debate' | 'dev' | null> {
    try {
      const rows = await this.db.query(`
        SELECT s.type 
        FROM sources s
        JOIN videos v ON s.id = v.source_id
        WHERE v.video_id = ?
      `, [videoId]);
      
      return rows.length > 0 ? rows[0].type : null;
    } catch (error) {
      console.error('Error getting source type:', error);
      return null;
    }
  }

  /**
   * Validate and enhance items from LLM
   */
  private async validateAndEnhanceItems(
    llmResult: VideoParsingResult, 
    video: VideoMetadata,
    sourceInfo: { type: 'news' | 'debate' | 'dev', weight: number, name: string }
  ): Promise<VideoParsingResult> {
    
    const enhancedResult = { ...llmResult };
    let validatedItems: any[] = [];

    // Process items based on source type
    let rawItems: any[] = [];
    if (sourceInfo.type === 'news' && llmResult.newsItems) {
      rawItems = llmResult.newsItems;
    } else if (sourceInfo.type === 'debate' && llmResult.debateItems) {
      rawItems = llmResult.debateItems;
    } else if (sourceInfo.type === 'dev' && llmResult.devItems) {
      rawItems = llmResult.devItems;
    }

    // Validate and enhance each item
    for (const item of rawItems) {
      const enhancedItem = await this.enhanceItem(item, video, sourceInfo);
      const validation = validateItem(enhancedItem, sourceInfo.type);
      
      if (validation.valid && validation.item) {
        validatedItems.push(validation.item);
      } else {
        console.warn(`⚠️ Invalid item rejected: ${validation.errors?.join(', ')}`);
      }
    }

    // Sort by quality/relevance
    validatedItems = this.rankItems(validatedItems, sourceInfo);

    // Update result with validated items
    enhancedResult.totalItems = validatedItems.length;
    if (sourceInfo.type === 'news') enhancedResult.newsItems = validatedItems as NewsItem[];
    else if (sourceInfo.type === 'debate') enhancedResult.debateItems = validatedItems as DebateItem[];
    else if (sourceInfo.type === 'dev') enhancedResult.devItems = validatedItems as DevItem[];

    return enhancedResult;
  }

  /**
   * Enhance individual item with additional data
   */
  private async enhanceItem(
    item: any, 
    video: VideoMetadata,
    sourceInfo: { type: 'news' | 'debate' | 'dev', weight: number, name: string }
  ): Promise<any> {
    // Add base properties
    const enhancedItem = {
      ...item,
      videoId: video.id,
      channelId: video.channelId,
      sourceUrl: video.url,
    };

    // Add fallback values for missing required fields
    if (!enhancedItem.relevance_score) {
      enhancedItem.relevance_score = 5; // Default to medium relevance
    }
    
    if (!enhancedItem.rawContext) {
      enhancedItem.rawContext = enhancedItem.title || enhancedItem.topic || 'Context unavailable';
    }

    if (!enhancedItem.confidence) {
      enhancedItem.confidence = 'medium'; // Safe default
    }

    // Type-specific fallbacks
    if (sourceInfo.type === 'debate') {
      if (!enhancedItem.implications) {
        enhancedItem.implications = 'Diskutert tema med potensielle konsekvenser for teknologi og samfunn.';
      }
      if (!enhancedItem.positions) {
        enhancedItem.positions = { pro: [], contra: [] };
      }
      if (!enhancedItem.keyQuotes) {
        enhancedItem.keyQuotes = [];
      }
    }

    if (sourceInfo.type === 'dev') {
      if (!enhancedItem.links) {
        enhancedItem.links = [];
      }
      if (!enhancedItem.changeType) {
        enhancedItem.changeType = 'tool';  // Most common fallback
      }
      if (!enhancedItem.developerAction) {
        enhancedItem.developerAction = 'evaluate';
      }
    }

    if (sourceInfo.type === 'news') {
      if (!enhancedItem.entities) {
        enhancedItem.entities = [];
      }
    }

    // Add timestamp if missing but we have rawContext
    if (!enhancedItem.timestamp && enhancedItem.rawContext) {
      enhancedItem.timestamp = this.findTimestampForContext(enhancedItem.rawContext, video);
    }

    // Calculate confidence if not set or enhance existing
    if (!enhancedItem.confidence || enhancedItem.confidence === 'low') {
      enhancedItem.confidence = this.calculateItemConfidence(enhancedItem, sourceInfo);
    }

    // Add quality score
    enhancedItem.qualityScore = this.calculateQualityScore(enhancedItem, sourceInfo);

    // Type-specific enhancements
    if (sourceInfo.type === 'news') {
      enhancedItem.affectedCompanies = this.extractCompanies(enhancedItem.entities || []);
    } else if (sourceInfo.type === 'dev') {
      enhancedItem.affectedTechnologies = this.extractTechnologies(enhancedItem.title || '');
    }

    return enhancedItem;
  }

  /**
   * Calculate confidence for an item
   */
  private calculateItemConfidence(item: any, sourceInfo: { weight: number }): 'high' | 'medium' | 'low' {
    const factors: ConfidenceFactors = {
      transcriptQuality: 0.8, // From transcript processor
      sourceReliability: Math.min(sourceInfo.weight, 1),
      informationClarity: this.assessInformationClarity(item),
      entityRecognition: this.assessEntityRecognition(item),
      timestampAccuracy: item.timestamp ? 0.8 : 0.3
    };

    return calculateConfidenceScore(factors);
  }

  /**
   * Assess information clarity
   */
  private assessInformationClarity(item: any): number {
    let score = 0.5;
    
    // Has clear title
    if (item.title && item.title.length > 10) score += 0.2;
    
    // Has detailed summary
    if (item.summary && item.summary.length > 20) score += 0.2;
    
    // Has entities/specifics
    if (item.entities && item.entities.length > 0) score += 0.1;
    
    // Has raw context
    if (item.rawContext && item.rawContext.length > 50) score += 0.1;
    
    return Math.min(score, 1.0);
  }

  /**
   * Assess entity recognition quality
   */
  private assessEntityRecognition(item: any): number {
    if (!item.entities || !Array.isArray(item.entities)) return 0.3;
    
    const entityCount = item.entities.length;
    if (entityCount === 0) return 0.2;
    if (entityCount <= 2) return 0.6;
    if (entityCount <= 5) return 0.8;
    return 0.9;
  }

  /**
   * Calculate overall quality score
   */
  private calculateQualityScore(item: any, sourceInfo: { weight: number }): number {
    // Primary score from LLM relevance assessment (normalized to 0-1)
    const llmScore = (item.relevance_score || 5) / 10;
    
    // Confidence adjustment
    const confidenceBoost = {
      'high': 0.1,
      'medium': 0.05,
      'low': 0
    }[item.confidence] || 0;
    
    // Detail completeness bonus (max 0.2)
    let detailBonus = 0;
    if (item.entities && item.entities.length > 0) detailBonus += 0.1;
    if (item.summary && item.summary.length > 100) detailBonus += 0.1;
    
    return Math.min(1.0, llmScore + confidenceBoost + detailBonus);
  }

  /**
   * Rank items by relevance and quality
   */
  private rankItems(items: any[], sourceInfo: { weight: number }): any[] {
    return items.sort((a, b) => {
      // Primary: Quality score
      const qualityDiff = (b.qualityScore || 0) - (a.qualityScore || 0);
      if (Math.abs(qualityDiff) > 0.1) return qualityDiff;
      
      // Secondary: Confidence
      const confidenceScore = { high: 3, medium: 2, low: 1 };
      const confDiff = confidenceScore[b.confidence] - confidenceScore[a.confidence];
      if (confDiff !== 0) return confDiff;
      
      // Tertiary: Content length (more detail usually better)
      const aLength = (a.summary || '').length + (a.title || '').length;
      const bLength = (b.summary || '').length + (b.title || '').length;
      return bLength - aLength;
    });
  }

  /**
   * Extract company names from entities
   */
  private extractCompanies(entities: string[]): string[] {
    const commonCompanies = [
      'OpenAI', 'Google', 'Microsoft', 'Meta', 'Apple', 'Amazon', 'Netflix',
      'Anthropic', 'DeepMind', 'Nvidia', 'Tesla', 'Uber', 'Airbnb'
    ];
    
    return entities.filter(entity => 
      commonCompanies.some(company => 
        entity.toLowerCase().includes(company.toLowerCase())
      )
    );
  }

  /**
   * Extract technologies from text
   */
  private extractTechnologies(text: string): string[] {
    const techKeywords = [
      'JavaScript', 'TypeScript', 'Python', 'React', 'Node.js', 'Docker',
      'Kubernetes', 'AWS', 'Azure', 'GCP', 'API', 'REST', 'GraphQL',
      'AI', 'ML', 'ChatGPT', 'GPT', 'LLM', 'Transformer', 'RAG'
    ];
    
    const lowerText = text.toLowerCase();
    return techKeywords.filter(tech => 
      lowerText.includes(tech.toLowerCase())
    );
  }

  /**
   * Find timestamp for context (simplified)
   */
  private findTimestampForContext(context: string, video: VideoMetadata): string | undefined {
    // This would ideally search through transcript segments
    // For now, return undefined to rely on LLM-provided timestamps
    return undefined;
  }

  /**
   * Save items to database
   */
  private async saveItems(result: VideoParsingResult, videoId: string): Promise<void> {
    try {
      // Get internal video ID
      const videoRows = await this.db.query(
        'SELECT id FROM videos WHERE video_id = ?',
        [videoId]
      );

      if (videoRows.length === 0) {
        throw new Error(`Video not found: ${videoId}`);
      }

      const internalVideoId = videoRows[0].id;
      const allItems = [
        ...(result.newsItems || []),
        ...(result.debateItems || []),
        ...(result.devItems || [])
      ];

      // Save each item
      for (const item of allItems) {
        await this.db.run(`
          INSERT INTO items (
            video_id, part, type, title, summary, entities, 
            timestamp_hms, links, confidence, relevance_score
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          internalVideoId,
          this.getPartForSourceType(result.sourceType),
          item.type || result.sourceType,
          item.title || item.topic || 'Untitled',
          item.summary || item.whatWasDiscussed || item.whatChanged || '',
          JSON.stringify(item.entities || []),
          item.timestamp,
          JSON.stringify(item.links || []),
          item.confidence,
          item.qualityScore || 0.5
        ]);
      }

      console.log(`💾 Saved ${allItems.length} items to database`);

    } catch (error) {
      console.error('Error saving items:', error);
      throw error;
    }
  }

  /**
   * Map source type to part number
   */
  private getPartForSourceType(sourceType: 'news' | 'debate' | 'dev'): number {
    switch (sourceType) {
      case 'news': return 1;
      case 'debate': return 2;
      case 'dev': return 3;
      default: return 1;
    }
  }

  /**
   * Get processing statistics
   */
  async getProcessingStats(): Promise<{
    totalItemsProcessed: number;
    averageItemsPerVideo: number;
    confidenceDistribution: Record<string, number>;
    llmUsage: ReturnType<LLMService['getUsageStats']>;
  }> {
    const stats = await this.db.query(`
      SELECT 
        COUNT(*) as total_items,
        AVG(relevance_score) as avg_quality,
        confidence,
        COUNT(*) as count_by_confidence
      FROM items
      GROUP BY confidence
    `);

    const confidenceDistribution = stats.reduce((acc: Record<string, number>, row: any) => {
      acc[row.confidence] = row.count_by_confidence;
      return acc;
    }, {});

    const totalItems = stats.reduce((sum: number, row: any) => sum + row.count_by_confidence, 0);

    return {
      totalItemsProcessed: totalItems,
      averageItemsPerVideo: totalItems / Math.max(stats.length, 1),
      confidenceDistribution,
      llmUsage: this.llmService.getUsageStats()
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.db.close();
  }
}
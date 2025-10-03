import { 
  TopicCluster, 
  SubTopic, 
  ClusteredItem, 
  ClusteredBrief, 
  EntityExtraction, 
  ClusteringConfig, 
  ClusterCandidate,
  TLDRPoint,
  ClusteringStats
} from '../types/clustering.types.js';
import { ParsedItem, NewsItem, DebateItem, DevItem } from '../types/schemas.js';

export class ContentClusteringService {
  private config: ClusteringConfig;

  constructor(config: Partial<ClusteringConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      minClusterSize: config.minClusterSize ?? 2,
      entityExtractionThreshold: config.entityExtractionThreshold ?? 0.7,
      preserveAllDetails: config.preserveAllDetails ?? true,
      generateSummaries: config.generateSummaries ?? true,
      tldrConfig: {
        enabled: config.tldrConfig?.enabled ?? true,
        maxPoints: config.tldrConfig?.maxPoints ?? 5,
        includeStats: config.tldrConfig?.includeStats ?? true
      }
    };
  }

  /**
   * Main clustering method
   */
  async clusterItems(items: ParsedItem[]): Promise<ClusteredBrief> {
    const startTime = Date.now();

    if (!this.config.enabled || items.length < 2) {
      return this.createEmptyBrief(items, startTime);
    }

    console.log(`🔄 Starting clustering for ${items.length} items`);

    // Step 1: Extract main entities
    const entities = await this.extractMainEntities(items);
    console.log(`🏷️ Found ${entities.length} potential entities for clustering`);

    // Step 2: Group items by topics
    const clusters = await this.groupByTopics(items, entities);
    console.log(`📊 Created ${clusters.length} clusters`);

    // Step 3: Process each cluster
    const processedClusters = await Promise.all(
      clusters.map(cluster => this.processCluster(cluster))
    );

    // Step 4: Identify standalone items
    const clusteredItemIds = new Set(
      processedClusters.flatMap(cluster => 
        cluster.subTopics.flatMap(subTopic => 
          subTopic.items.map(item => this.getItemId(item.originalItem))
        )
      )
    );

    const standaloneItems = items.filter(item => 
      !clusteredItemIds.has(this.getItemId(item))
    );

    // Step 5: Generate TL;DR
    const tldr = this.config.tldrConfig.enabled 
      ? await this.generateTLDR(processedClusters, standaloneItems)
      : [];

    // Step 6: Generate stats
    const stats = this.generateStats(processedClusters, standaloneItems, startTime);

    console.log(`✅ Clustering complete: ${processedClusters.length} clusters, ${standaloneItems.length} standalone`);

    return {
      clusters: processedClusters,
      standaloneItems,
      stats,
      tldr,
      generatedAt: new Date()
    };
  }

  /**
   * Extract main entities from items
   */
  private async extractMainEntities(items: ParsedItem[]): Promise<EntityExtraction[]> {
    const entityFrequency = new Map<string, { count: number; contexts: string[]; items: ParsedItem[] }>();

    // Scan all items for entities
    items.forEach(item => {
      const text = this.getItemText(item);
      const extractedEntities = this.extractEntitiesFromText(text);

      extractedEntities.forEach(entity => {
        if (!entityFrequency.has(entity)) {
          entityFrequency.set(entity, { count: 0, contexts: [], items: [] });
        }
        const entry = entityFrequency.get(entity)!;
        entry.count += 1;
        entry.contexts.push(text.substring(0, 100));
        entry.items.push(item);
      });
    });

    // Convert to EntityExtraction format
    const entities: EntityExtraction[] = [];
    entityFrequency.forEach((data, entity) => {
      if (data.count >= this.config.minClusterSize) {
        entities.push({
          entity,
          frequency: data.count,
          contexts: data.contexts,
          type: this.classifyEntityType(entity, data.contexts),
          confidence: this.calculateEntityConfidence(entity, data.count, items.length)
        });
      }
    });

    // Sort by frequency and confidence
    return entities
      .filter(e => e.confidence >= this.config.entityExtractionThreshold)
      .sort((a, b) => (b.frequency * b.confidence) - (a.frequency * a.confidence))
      .slice(0, 10); // Max 10 main entities to avoid over-clustering
  }

  /**
   * Extract entities from text using pattern matching
   */
  private extractEntitiesFromText(text: string): string[] {
    const entities: string[] = [];
    
    // Common AI/tech entities patterns
    const patterns = [
      // Companies
      /\b(OpenAI|Anthropic|Google|Microsoft|Meta|Apple|Amazon|Tesla|GitHub|Nvidia)\b/gi,
      // Products
      /\b(GPT-?[0-9o]+(?:\.[0-9]+)?|Claude(?:\s+[0-9.]+)?|Sora(?:\s+[0-9])?|Gemini(?:\s+[0-9.]+)?|ChatGPT|Copilot|Whisper|DALL-E)\b/gi,
      // Technologies
      /\b(AI|Machine Learning|LLM|Neural Network|Transformer|API|SDK)\b/gi,
      // Tools/Platforms
      /\b(VS Code|Visual Studio|Chrome|Safari|Docker|Kubernetes|React|Node\.js)\b/gi
    ];

    patterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const normalized = this.normalizeEntity(match);
          if (!entities.includes(normalized)) {
            entities.push(normalized);
          }
        });
      }
    });

    return entities;
  }

  /**
   * Normalize entity names for consistent clustering
   */
  private normalizeEntity(entity: string): string {
    return entity
      .toLowerCase()
      .replace(/[-\s]+/g, ' ')
      .replace(/\b(gpt|claude|sora|gemini)\s*(\d+\.?\d*)\b/gi, '$1 $2')
      .trim();
  }

  /**
   * Classify entity type
   */
  private classifyEntityType(entity: string, contexts: string[]): EntityExtraction['type'] {
    const entityLower = entity.toLowerCase();
    
    // Companies
    if (/\b(openai|anthropic|google|microsoft|meta|apple|amazon|tesla|github|nvidia)\b/.test(entityLower)) {
      return 'company';
    }
    
    // Products
    if (/\b(gpt|claude|sora|gemini|chatgpt|copilot|whisper|dall-e)\b/.test(entityLower)) {
      return 'product';
    }
    
    // Concepts
    if (/\b(ai|machine learning|llm|neural network)\b/.test(entityLower)) {
      return 'concept';
    }
    
    // Check contexts for more clues
    const contextText = contexts.join(' ').toLowerCase();
    if (contextText.includes('ceo') || contextText.includes('founder')) {
      return 'person';
    }
    
    return 'concept'; // Default
  }

  /**
   * Calculate confidence for entity extraction
   */
  private calculateEntityConfidence(entity: string, frequency: number, totalItems: number): number {
    const frequencyScore = Math.min(frequency / totalItems, 0.5); // Max 0.5 for frequency
    const entityLengthScore = Math.min(entity.length / 20, 0.3); // Longer entities often more specific
    const knownEntityBonus = this.isKnownEntity(entity) ? 0.2 : 0;
    
    return Math.min(frequencyScore + entityLengthScore + knownEntityBonus, 1.0);
  }

  /**
   * Check if entity is a known AI/tech entity
   */
  private isKnownEntity(entity: string): boolean {
    const knownEntities = [
      'openai', 'anthropic', 'google', 'microsoft', 'meta',
      'gpt', 'claude', 'sora', 'gemini', 'chatgpt', 'copilot',
      'ai', 'machine learning', 'llm'
    ];
    return knownEntities.some(known => entity.toLowerCase().includes(known));
  }

  /**
   * Group items by identified topics/entities
   */
  private async groupByTopics(items: ParsedItem[], entities: EntityExtraction[]): Promise<ClusterCandidate[]> {
    const clusters: ClusterCandidate[] = [];

    entities.forEach(entityData => {
      const relatedItems = items.filter(item => 
        this.isItemRelatedToEntity(item, entityData.entity)
      );

      if (relatedItems.length >= this.config.minClusterSize) {
        clusters.push({
          entity: entityData.entity,
          relatedItems,
          score: this.calculateClusterScore(relatedItems),
          type: entityData.type
        });
      }
    });

    return clusters.sort((a, b) => b.score - a.score);
  }

  /**
   * Check if item is related to entity
   */
  private isItemRelatedToEntity(item: ParsedItem, entity: string): boolean {
    const text = this.getItemText(item).toLowerCase();
    const entityLower = entity.toLowerCase();
    
    // Direct mention
    if (text.includes(entityLower)) {
      return true;
    }
    
    // Fuzzy matching for close variants
    return this.fuzzyMatch(text, entityLower);
  }

  /**
   * Simple fuzzy matching for entity variants
   */
  private fuzzyMatch(text: string, entity: string): boolean {
    // Check for partial matches with high confidence entities
    const entityParts = entity.split(' ');
    if (entityParts.length > 1) {
      return entityParts.some(part => 
        part.length > 2 && text.includes(part)
      );
    }
    return false;
  }

  /**
   * Calculate cluster score based on item relevance and count
   */
  private calculateClusterScore(items: ParsedItem[]): number {
    const avgRelevance = items.reduce((sum, item) => 
      sum + (item.relevance_score || 5), 0) / items.length;
    const countBonus = Math.min(items.length * 0.5, 3); // Max 3 point bonus for count
    return avgRelevance + countBonus;
  }

  /**
   * Process individual cluster into final structure
   */
  private async processCluster(candidate: ClusterCandidate): Promise<TopicCluster> {
    // Analyze sub-topics within cluster
    const subTopics = await this.analyzeSubTopics(candidate.relatedItems);
    
    // Generate source attributions
    const sources = this.generateSourceAttributions(candidate.relatedItems);
    
    // Calculate overall cluster confidence
    const avgConfidence = this.calculateClusterConfidence(candidate.relatedItems);

    return {
      mainEntity: candidate.entity,
      entityType: candidate.type,
      itemCount: candidate.relatedItems.length,
      subTopics,
      relevanceScore: candidate.score,
      sources,
      confidence: avgConfidence
    };
  }

  /**
   * Analyze sub-topics within a cluster
   */
  private async analyzeSubTopics(items: ParsedItem[]): Promise<SubTopic[]> {
    // Group items by sub-categories
    const categories = new Map<SubTopic['category'], ClusteredItem[]>();
    
    items.forEach(item => {
      const category = this.categorizeItem(item);
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      
      const clusteredItem: ClusteredItem = {
        originalItem: item,
        uniqueAspects: this.extractUniqueAspects(item, items),
        sourceDetails: this.extractSourceDetails(item),
        clusterRelevance: item.relevance_score || 5
      };
      
      categories.get(category)!.push(clusteredItem);
    });

    // Convert to SubTopic array
    const subTopics: SubTopic[] = [];
    categories.forEach((categoryItems, category) => {
      if (categoryItems.length > 0) {
        subTopics.push({
          category,
          items: categoryItems.sort((a, b) => b.clusterRelevance - a.clusterRelevance),
          itemCount: categoryItems.length,
          summary: this.config.generateSummaries 
            ? this.generateSubTopicSummary(categoryItems, category)
            : undefined
        });
      }
    });

    return subTopics.sort((a, b) => b.itemCount - a.itemCount);
  }

  /**
   * Categorize item into sub-topic
   */
  private categorizeItem(item: ParsedItem): SubTopic['category'] {
    const text = this.getItemText(item).toLowerCase();
    
    // Keywords for each category
    const categoryKeywords = {
      launch: ['lanseres', 'lanceres', 'released', 'announces', 'unveils', 'debuts'],
      features: ['funksjoner', 'features', 'capabilities', 'can now', 'introduces'],
      technical: ['benchmark', 'performance', 'technical', 'teknisk', 'algorithm', 'model'],
      ethical: ['ethics', 'etisk', 'concerns', 'bekymring', 'problematisk', 'controversy'],
      business: ['investering', 'funding', 'business', 'revenue', 'market', 'competition'],
      comparison: ['vs', 'versus', 'compared', 'better than', 'outperforms'],
      criticism: ['kritikk', 'criticism', 'negative', 'problem', 'issues', 'concerns']
    };

    // Find best matching category
    let bestCategory: SubTopic['category'] = 'other';
    let maxMatches = 0;

    Object.entries(categoryKeywords).forEach(([category, keywords]) => {
      const matches = keywords.filter(keyword => text.includes(keyword)).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        bestCategory = category as SubTopic['category'];
      }
    });

    return bestCategory;
  }

  /**
   * Extract unique aspects of item compared to others in cluster
   */
  private extractUniqueAspects(item: ParsedItem, allItems: ParsedItem[]): string[] {
    const itemText = this.getItemText(item).toLowerCase();
    const otherTexts = allItems
      .filter(otherItem => otherItem !== item)
      .map(otherItem => this.getItemText(otherItem).toLowerCase());
    
    // Find unique keywords/phrases
    const uniqueAspects: string[] = [];
    const itemWords = itemText.split(/\s+/).filter(word => word.length > 3);
    
    itemWords.forEach(word => {
      const uniqueness = otherTexts.filter(text => text.includes(word)).length;
      if (uniqueness === 0 && word.length > 4) {
        // This word only appears in this item
        uniqueAspects.push(word);
      }
    });

    return uniqueAspects.slice(0, 3); // Max 3 unique aspects
  }

  /**
   * Extract source details from item
   */
  private extractSourceDetails(item: ParsedItem): ClusteredItem['sourceDetails'] {
    return {
      channel: this.extractChannelName(item),
      confidence: item.confidence,
      videoUrl: item.sourceUrl,
      timestamp: item.timestamp,
      videotitle: this.extractVideoTitle(item)
    };
  }

  /**
   * Generate source attributions for cluster
   */
  private generateSourceAttributions(items: ParsedItem[]): any[] {
    const sourceMap = new Map();
    
    items.forEach(item => {
      const channel = this.extractChannelName(item);
      if (!sourceMap.has(channel)) {
        sourceMap.set(channel, {
          channelName: channel,
          videoUrl: item.sourceUrl,
          itemCount: 0,
          confidenceLevels: [],
          totalRelevance: 0
        });
      }
      
      const source = sourceMap.get(channel);
      source.itemCount += 1;
      source.confidenceLevels.push(item.confidence);
      source.totalRelevance += item.relevance_score || 5;
    });

    // Convert to final format
    return Array.from(sourceMap.values()).map(source => ({
      ...source,
      avgRelevanceScore: source.totalRelevance / source.itemCount
    }));
  }

  /**
   * Calculate overall cluster confidence
   */
  private calculateClusterConfidence(items: ParsedItem[]): 'high' | 'medium' | 'low' {
    const confidenceScores = { high: 3, medium: 2, low: 1 };
    const avgScore = items.reduce((sum, item) => 
      sum + confidenceScores[item.confidence], 0) / items.length;
    
    if (avgScore >= 2.5) return 'high';
    if (avgScore >= 1.5) return 'medium';
    return 'low';
  }

  /**
   * Generate sub-topic summary
   */
  private generateSubTopicSummary(items: ClusteredItem[], category: SubTopic['category']): string {
    const itemCount = items.length;
    const entityName = this.extractCommonEntity(items);
    
    const summaryTemplates = {
      launch: `${entityName} lansering dekket av ${itemCount} kilder`,
      features: `Nye ${entityName} funksjoner og muligheter`,
      technical: `Tekniske aspekter og ytelse av ${entityName}`,
      ethical: `Etiske bekymringer og debatt rundt ${entityName}`,
      business: `Forretningsaspekter og markedspåvirkning`,
      comparison: `Sammenligning med konkurrenter`,
      criticism: `Kritikk og negative aspekter`,
      other: `Andre aspekter ved ${entityName}`
    };

    return summaryTemplates[category] || `${itemCount} relaterte items`;
  }

  /**
   * Extract common entity from clustered items
   */
  private extractCommonEntity(items: ClusteredItem[]): string {
    // Simple extraction - find most common capitalized word
    const entities = new Map<string, number>();
    
    items.forEach(item => {
      const text = this.getItemText(item.originalItem);
      const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z0-9][a-z0-9]*)*\b/g) || [];
      matches.forEach(match => {
        entities.set(match, (entities.get(match) || 0) + 1);
      });
    });

    // Return most frequent entity or generic term
    const mostCommon = Array.from(entities.entries()).sort((a, b) => b[1] - a[1])[0];
    return mostCommon ? mostCommon[0] : 'emnet';
  }

  /**
   * Generate TL;DR points
   */
  private async generateTLDR(clusters: TopicCluster[], standaloneItems: ParsedItem[]): Promise<TLDRPoint[]> {
    const tldrPoints: TLDRPoint[] = [];

    // Add major clusters to TL;DR
    clusters
      .filter(cluster => cluster.itemCount >= 3)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, this.config.tldrConfig.maxPoints - 1)
      .forEach(cluster => {
        tldrPoints.push({
          summary: `${cluster.mainEntity}: ${this.generateClusterSummary(cluster)}`,
          sourceCount: cluster.sources.length,
          relevanceScore: cluster.relevanceScore,
          mainEntity: cluster.mainEntity,
          category: cluster.relevanceScore >= 8 ? 'breaking' : 
                   cluster.relevanceScore >= 6 ? 'major' : 'notable'
        });
      });

    // Add top standalone items if space allows
    const remainingSlots = this.config.tldrConfig.maxPoints - tldrPoints.length;
    if (remainingSlots > 0) {
      standaloneItems
        .sort((a, b) => (b.relevance_score || 5) - (a.relevance_score || 5))
        .slice(0, remainingSlots)
        .forEach(item => {
          tldrPoints.push({
            summary: this.getItemTitle(item),
            sourceCount: 1,
            relevanceScore: item.relevance_score || 5,
            category: (item.relevance_score || 5) >= 8 ? 'breaking' : 
                     (item.relevance_score || 5) >= 6 ? 'major' : 'notable'
          });
        });
    }

    return tldrPoints.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Generate cluster summary for TL;DR
   */
  private generateClusterSummary(cluster: TopicCluster): string {
    const topCategory = cluster.subTopics[0]?.category || 'updates';
    const sourceCount = cluster.sources.length;
    
    const summaries = {
      launch: `Ny lansering (${sourceCount} kilder)`,
      features: `Nye funksjoner (${sourceCount} kilder)`,
      technical: `Tekniske forbedringer (${sourceCount} kilder)`,
      business: `Forretningsoppdateringer (${sourceCount} kilder)`,
      ethical: `Debatt og bekymringer (${sourceCount} kilder)`
    };

    return summaries[topCategory] || `Oppdateringer (${sourceCount} kilder)`;
  }

  /**
   * Generate clustering statistics
   */
  private generateStats(clusters: TopicCluster[], standaloneItems: ParsedItem[], startTime: number): ClusteringStats {
    const clusteredItemCount = clusters.reduce((sum, cluster) => sum + cluster.itemCount, 0);
    const clusterSizes = clusters.map(c => c.itemCount);
    
    return {
      totalItems: clusteredItemCount + standaloneItems.length,
      clusteredItems: clusteredItemCount,
      standaloneItems: standaloneItems.length,
      totalClusters: clusters.length,
      largestClusterSize: clusterSizes.length > 0 ? Math.max(...clusterSizes) : 0,
      averageClusterSize: clusterSizes.length > 0 ? clusterSizes.reduce((a, b) => a + b, 0) / clusterSizes.length : 0,
      processingTimeMs: Date.now() - startTime
    };
  }

  /**
   * Create empty brief when clustering disabled or insufficient items
   */
  private createEmptyBrief(items: ParsedItem[], startTime: number): ClusteredBrief {
    return {
      clusters: [],
      standaloneItems: items,
      stats: {
        totalItems: items.length,
        clusteredItems: 0,
        standaloneItems: items.length,
        totalClusters: 0,
        largestClusterSize: 0,
        averageClusterSize: 0,
        processingTimeMs: Date.now() - startTime
      },
      tldr: [],
      generatedAt: new Date()
    };
  }

  // Helper methods
  private getItemText(item: ParsedItem): string {
    if ('title' in item && item.title) return `${item.title} ${item.summary || ''}`;
    if ('topic' in item && item.topic) return `${item.topic} ${item.whatWasDiscussed || ''}`;
    if ('whatChanged' in item) return `${item.title || ''} ${item.whatChanged || ''}`;
    return '';
  }

  private getItemTitle(item: ParsedItem): string {
    if ('title' in item && item.title) return item.title;
    if ('topic' in item && item.topic) return item.topic;
    return 'Untitled item';
  }

  private getItemId(item: ParsedItem): string {
    return `${item.videoId}-${this.getItemTitle(item).substring(0, 20)}`;
  }

  private extractChannelName(item: ParsedItem): string {
    // Simple extraction from sourceUrl or fallback
    if (item.sourceUrl && item.sourceUrl.includes('youtube.com')) {
      // Could be enhanced to extract actual channel name
      return 'YouTube Channel';
    }
    return 'Unknown Source';
  }

  private extractVideoTitle(item: ParsedItem): string {
    // Would need video metadata - placeholder for now
    return 'Video Title';
  }
}
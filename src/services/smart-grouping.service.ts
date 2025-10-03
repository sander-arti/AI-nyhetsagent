import { NewsItem, DebateItem, DevItem } from '../types/schemas.js';

export type ParsedItem = NewsItem | DebateItem | DevItem;

export interface EntityGroup {
  entity: string;
  entityType: 'product' | 'company' | 'person' | 'concept';
  items: GroupedItem[];
  totalItems: number;
}

export interface GroupedItem {
  item: ParsedItem;
  uniqueAspect: string;
  category: 'launch' | 'features' | 'technical' | 'ethical' | 'business' | 'criticism' | 'other';
}

export interface GroupedBrief {
  entityGroups: EntityGroup[];
  standaloneItems: ParsedItem[];
  stats: {
    totalItems: number;
    groupedItems: number;
    standaloneItems: number;
    totalGroups: number;
  };
}

export interface SmartGroupingConfig {
  enabled: boolean;
  minGroupSize: number; // 2+ items for grouping
  preserveDetails: boolean;
}

export class SmartGroupingService {
  private config: SmartGroupingConfig;

  constructor(config: Partial<SmartGroupingConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      minGroupSize: config.minGroupSize ?? 2,
      preserveDetails: config.preserveDetails ?? true
    };
  }

  /**
   * Main grouping method - implements Alternative B hybrid hierarchy
   */
  async groupItems(items: ParsedItem[]): Promise<GroupedBrief> {
    if (!this.config.enabled || items.length < 2) {
      return this.createNoGroupBrief(items);
    }

    console.log(`🔄 Smart grouping ${items.length} items (min group size: ${this.config.minGroupSize})`);

    // Phase 1: Entity Detection & Frequency Analysis
    const entityFrequency = this.analyzeEntityFrequency(items);
    console.log(`🏷️ Found ${entityFrequency.size} potential entities`);

    // Phase 2: Group by entities that meet threshold
    const entityGroups: EntityGroup[] = [];
    const ungroupedItems = [...items];

    for (const [entity, data] of entityFrequency.entries()) {
      if (data.items.length >= this.config.minGroupSize) {
        const group = this.createEntityGroup(entity, data.items);
        entityGroups.push(group);
        
        // Remove grouped items from ungrouped list
        data.items.forEach(groupedItem => {
          const index = ungroupedItems.findIndex(item => this.getItemId(item) === this.getItemId(groupedItem));
          if (index !== -1) {
            ungroupedItems.splice(index, 1);
          }
        });
      }
    }

    console.log(`📊 Created ${entityGroups.length} entity groups, ${ungroupedItems.length} standalone items`);

    return {
      entityGroups,
      standaloneItems: ungroupedItems,
      stats: {
        totalItems: items.length,
        groupedItems: entityGroups.reduce((sum, group) => sum + group.totalItems, 0),
        standaloneItems: ungroupedItems.length,
        totalGroups: entityGroups.length
      }
    };
  }

  /**
   * Phase 1: Analyze entity frequency across all items
   */
  private analyzeEntityFrequency(items: ParsedItem[]): Map<string, { items: ParsedItem[], contexts: string[] }> {
    const frequency = new Map<string, { items: ParsedItem[], contexts: string[] }>();

    items.forEach(item => {
      const entities = this.extractEntitiesFromItem(item);
      entities.forEach(entity => {
        if (!frequency.has(entity)) {
          frequency.set(entity, { items: [], contexts: [] });
        }
        frequency.get(entity)!.items.push(item);
        frequency.get(entity)!.contexts.push(this.getItemText(item));
      });
    });

    return frequency;
  }

  /**
   * Extract main entity from item using simple pattern matching
   * Returns only the most relevant entity to avoid over-grouping
   */
  private extractEntitiesFromItem(item: ParsedItem): string[] {
    const text = this.getItemText(item).toLowerCase();

    // Version patterns (highest priority - most specific)
    const versionPatterns = [
      'sora 2', 'claude 4.5', 'sonnet 4.5', 'gpt-5', 'gpt 5', 'gemini 2.0', 'copilot+'
    ];

    // Product/Service entities (medium priority)
    const productPatterns = [
      'sora', 'claude', 'gpt', 'gemini', 'copilot', 'chatgpt'
    ];

    // Check version patterns first (most specific)
    for (const pattern of versionPatterns) {
      if (text.includes(pattern)) {
        return [this.normalizeEntity(pattern)]; // Return only the main entity
      }
    }

    // Then check product patterns
    for (const pattern of productPatterns) {
      if (text.includes(pattern)) {
        return [this.normalizeEntity(pattern)]; // Return only the main entity
      }
    }

    // No main entity found
    return [];
  }

  /**
   * Create entity group with hybrid hierarchy
   */
  private createEntityGroup(entity: string, items: ParsedItem[]): EntityGroup {
    const groupedItems: GroupedItem[] = items.map(item => ({
      item,
      uniqueAspect: this.extractUniqueAspect(item, entity),
      category: this.categorizeItem(item, entity)
    }));

    return {
      entity: this.normalizeEntity(entity),
      entityType: this.determineEntityType(entity),
      items: groupedItems,
      totalItems: items.length
    };
  }

  /**
   * Extract unique aspect for each item within a group
   */
  private extractUniqueAspect(item: ParsedItem, entity: string): string {
    const text = this.getItemText(item).toLowerCase();
    
    // Look for unique details specific to this item
    if (item.type === 'news' && 'summary' in item) {
      return item.summary;
    } else if (item.type === 'debate' && 'whatWasDiscussed' in item) {
      return item.whatWasDiscussed;
    } else if (item.type === 'dev' && 'whatChanged' in item) {
      return item.whatChanged;
    }
    
    // Fallback to raw context
    return item.rawContext;
  }

  /**
   * Categorize item within entity context
   */
  private categorizeItem(item: ParsedItem, entity: string): GroupedItem['category'] {
    const text = this.getItemText(item).toLowerCase();

    // Launch/Release indicators
    if (text.includes('lanserte') || text.includes('lanserer') || text.includes('release') || 
        text.includes('unveiled') || text.includes('introduced') || text.includes('announced')) {
      return 'launch';
    }

    // Features indicators  
    if (text.includes('funksjon') || text.includes('feature') || text.includes('capability') ||
        text.includes('forbedring') || text.includes('improvement') || text.includes('update') ||
        text.includes('cameo') || text.includes('fysikk') || text.includes('realisme')) {
      return 'features';
    }

    // Technical indicators
    if (text.includes('benchmark') || text.includes('performance') || text.includes('technical') ||
        text.includes('model') || text.includes('algorithm') || text.includes('prosentpoeng') ||
        text.includes('sweetbench') || text.includes('timer')) {
      return 'technical';
    }

    // Ethical indicators
    if (text.includes('etisk') || text.includes('ethical') || text.includes('bekymring') || 
        text.includes('concern') || text.includes('worry') || text.includes('risk') || 
        text.includes('safety') || text.includes('avhengighet') || text.includes('implikasjon')) {
      return 'ethical';
    }

    // Business indicators
    if (text.includes('business') || text.includes('market') || text.includes('revenue') ||
        text.includes('cost') || text.includes('pricing') || text.includes('kostnadsreduksjon')) {
      return 'business';
    }

    // Criticism indicators
    if (text.includes('criticism') || text.includes('critical') || text.includes('negative') ||
        text.includes('problem') || text.includes('issue') || text.includes('kritikk')) {
      return 'criticism';
    }

    return 'other';
  }

  /**
   * Determine entity type
   */
  private determineEntityType(entity: string): EntityGroup['entityType'] {
    const products = ['sora', 'claude', 'gpt', 'gemini', 'copilot', 'chatgpt'];
    const companies = ['openai', 'anthropic', 'google', 'microsoft', 'meta'];

    if (products.some(p => entity.toLowerCase().includes(p))) {
      return 'product';
    } else if (companies.some(c => entity.toLowerCase().includes(c))) {
      return 'company';
    } else {
      return 'concept';
    }
  }

  /**
   * Get item text for analysis
   */
  private getItemText(item: ParsedItem): string {
    let text = item.rawContext || '';
    
    if (item.type === 'news' && 'summary' in item) {
      text += ' ' + item.summary;
      if ('title' in item) text += ' ' + item.title;
    } else if (item.type === 'debate' && 'topic' in item) {
      text += ' ' + item.topic;
      if ('whatWasDiscussed' in item) text += ' ' + item.whatWasDiscussed;
    } else if (item.type === 'dev' && 'title' in item) {
      text += ' ' + item.title;
      if ('whatChanged' in item) text += ' ' + item.whatChanged;
    }

    return text;
  }

  /**
   * Get unique ID for item
   */
  private getItemId(item: ParsedItem): string {
    return `${item.videoId}_${item.timestamp}`;
  }

  /**
   * Normalize entity name and group related entities
   */
  private normalizeEntity(entity: string): string {
    const normalized = entity.toLowerCase().trim();
    
    // Group Sora variants
    if (normalized.includes('sora')) {
      return 'Sora 2';
    }
    
    // Group Claude variants  
    if (normalized.includes('claude') || normalized.includes('sonnet')) {
      return 'Claude 4.5';
    }
    
    // Group GPT variants
    if (normalized.includes('gpt')) {
      return 'GPT-5';
    }
    
    // Group Gemini variants
    if (normalized.includes('gemini')) {
      return 'Gemini';
    }
    
    // Default: capitalize first letter of each word
    return normalized.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Create brief with no grouping
   */
  private createNoGroupBrief(items: ParsedItem[]): GroupedBrief {
    return {
      entityGroups: [],
      standaloneItems: items,
      stats: {
        totalItems: items.length,
        groupedItems: 0,
        standaloneItems: items.length,
        totalGroups: 0
      }
    };
  }
}
import { WebClient, Block, KnownBlock } from '@slack/web-api';
import { GroupedBrief, EntityGroup, GroupedItem, ParsedItem } from './smart-grouping.service.js';
import { NewsItem, DebateItem, DevItem } from '../types/schemas.js';

export interface HierarchicalSlackBriefData {
  runId: string;
  processedSources: number;
  videosFound: number;
  videosTranscribed: number;
  totalCost: number;
  duration: string;
  groupedBrief: GroupedBrief;
  timestamp: Date;
}

export class HierarchicalSlackService {
  private client: WebClient;

  constructor(token: string) {
    this.client = new WebClient(token);
  }

  /**
   * Send hierarchical brief to Slack - Alternative B implementation
   */
  async sendHierarchicalBrief(briefData: HierarchicalSlackBriefData, channelId: string) {
    try {
      const blocks = await this.buildHierarchicalBlocks(briefData);
      
      await this.client.chat.postMessage({
        channel: channelId,
        text: `🤖 AI-nyhetsagent brief - ${briefData.groupedBrief.stats.totalItems} items`,
        blocks: blocks,
        unfurl_links: false,
        unfurl_media: false
      });

      return { success: true };
    } catch (error) {
      console.error('❌ Failed to send hierarchical Slack brief:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Build hierarchical blocks implementing Alternative B structure
   */
  private async buildHierarchicalBlocks(briefData: HierarchicalSlackBriefData): Promise<Block[]> {
    const blocks: Block[] = [];
    const { groupedBrief } = briefData;

    // Header with stats
    blocks.push(...this.buildHeader(briefData));
    
    // TL;DR section if we have groups
    if (groupedBrief.entityGroups.length > 0) {
      blocks.push(...this.buildTLDRSection(groupedBrief));
    }

    // Entity Groups (Alternative B: Topic → Aspects → Sources)
    for (const group of groupedBrief.entityGroups) {
      blocks.push(...this.buildEntityGroupBlocks(group));
    }

    // Standalone items by type
    if (groupedBrief.standaloneItems.length > 0) {
      blocks.push(...this.buildStandaloneSection(groupedBrief.standaloneItems));
    }

    // Footer
    blocks.push(this.buildFooter(briefData));

    return blocks;
  }

  /**
   * Build header with run stats
   */
  private buildHeader(briefData: HierarchicalSlackBriefData): Block[] {
    const stats = briefData.groupedBrief.stats;
    
    return [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `🤖 AI-nyhetsagent Brief - ${stats.totalItems} items`
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `📊 ${briefData.processedSources} sources • ${briefData.videosFound} videos • ${briefData.videosTranscribed} transcribed • ⏱️ ${briefData.duration} • 💰 $${briefData.totalCost.toFixed(4)}`
          }
        ]
      },
      { type: 'divider' }
    ];
  }

  /**
   * Build TL;DR section - key points from all groups
   */
  private buildTLDRSection(groupedBrief: GroupedBrief): Block[] {
    const tldrPoints = this.extractTLDRPoints(groupedBrief);
    
    if (tldrPoints.length === 0) return [];

    const blocks: Block[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*📋 TL;DR - Hovedpunkter:*'
        }
      }
    ];

    tldrPoints.slice(0, 5).forEach((point, index) => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${index + 1}.* ${point.summary}\n_${point.sourceCount} kilder • ${point.category}_`
        }
      });
    });

    blocks.push({ type: 'divider' });
    return blocks;
  }

  /**
   * Build entity group blocks with Alternative B hierarchy
   */
  private buildEntityGroupBlocks(group: EntityGroup): Block[] {
    const blocks: Block[] = [];

    // Main entity header
    const entityEmoji = this.getEntityEmoji(group.entityType);
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${entityEmoji} *${group.entity.toUpperCase()}*\n_${group.totalItems} items • ${group.entityType}_`
      }
    });

    // Group by category (aspects)
    const categoryGroups = this.groupByCategory(group.items);
    
    for (const [category, items] of categoryGroups.entries()) {
      blocks.push(...this.buildCategorySection(category, items, group.entity));
    }

    blocks.push({ type: 'divider' });
    return blocks;
  }

  /**
   * Build category section with items preserving unique details
   */
  private buildCategorySection(category: string, items: GroupedItem[], entity: string): Block[] {
    const blocks: Block[] = [];
    const categoryEmoji = this.getCategoryEmoji(category);
    
    // Category header
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${categoryEmoji} *${this.formatCategory(category)}*`
      }
    });

    // Individual items with unique details preserved
    items.forEach(groupedItem => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: this.formatGroupedItem(groupedItem)
        }
      });
    });

    return blocks;
  }

  /**
   * Format individual grouped item preserving all unique details
   */
  private formatGroupedItem(groupedItem: GroupedItem): string {
    const { item } = groupedItem;
    const confidence = this.getConfidenceEmoji(item.confidence);
    
    let text = `├─ ${groupedItem.uniqueAspect}`;
    
    // Add specific details based on item type
    if (item.type === 'news' && 'entities' in item && item.entities?.length > 0) {
      text += `\n│  🏷️ *Entities*: ${item.entities.join(', ')}`;
    }
    
    if (item.type === 'debate' && 'positions' in item) {
      const positions = item.positions;
      if (positions?.pro?.length > 0) {
        text += `\n│  ✅ *Pro*: ${positions.pro.join(', ')}`;
      }
      if (positions?.contra?.length > 0) {
        text += `\n│  ❌ *Contra*: ${positions.contra.join(', ')}`;
      }
    }
    
    if (item.type === 'dev' && 'affectedTechnologies' in item && item.affectedTechnologies?.length > 0) {
      text += `\n│  🔧 *Tech*: ${item.affectedTechnologies.join(', ')}`;
    }

    // Source attribution
    text += `\n└─ _📺 ${this.getChannelName(item.channelId)} ${confidence} • ⏱️ ${item.timestamp}_`;
    
    return text;
  }

  /**
   * Build standalone items section
   */
  private buildStandaloneSection(items: ParsedItem[]): Block[] {
    const blocks: Block[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*📌 Standalone Items*'
        }
      }
    ];

    // Group by type
    const grouped = this.groupStandaloneByType(items);
    
    for (const [type, typeItems] of grouped.entries()) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${this.formatItemType(type)}* (${typeItems.length})`
        }
      });

      typeItems.forEach(item => {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: this.formatStandaloneItem(item)
          }
        });
      });
    }

    return blocks;
  }

  /**
   * Build footer with grouping stats
   */
  private buildFooter(briefData: HierarchicalSlackBriefData): Block {
    const stats = briefData.groupedBrief.stats;
    return {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🔗 *Smart Grouping*: ${stats.totalGroups} groups • ${stats.groupedItems} grouped • ${stats.standaloneItems} standalone • Generated at ${briefData.timestamp.toLocaleString('nb-NO')}`
        }
      ]
    };
  }

  // Helper methods for formatting and organization

  private extractTLDRPoints(groupedBrief: GroupedBrief): Array<{summary: string, sourceCount: number, category: string}> {
    return groupedBrief.entityGroups.map(group => ({
      summary: `${group.entity}: ${this.summarizeGroupAspects(group)}`,
      sourceCount: group.totalItems,
      category: group.entityType
    })).sort((a, b) => b.sourceCount - a.sourceCount);
  }

  private summarizeGroupAspects(group: EntityGroup): string {
    const categories = [...new Set(group.items.map(item => item.category))];
    return categories.map(cat => this.formatCategory(cat)).join(', ');
  }

  private groupByCategory(items: GroupedItem[]): Map<string, GroupedItem[]> {
    const groups = new Map<string, GroupedItem[]>();
    items.forEach(item => {
      if (!groups.has(item.category)) {
        groups.set(item.category, []);
      }
      groups.get(item.category)!.push(item);
    });
    return groups;
  }

  private groupStandaloneByType(items: ParsedItem[]): Map<string, ParsedItem[]> {
    const groups = new Map<string, ParsedItem[]>();
    items.forEach(item => {
      if (!groups.has(item.type)) {
        groups.set(item.type, []);
      }
      groups.get(item.type)!.push(item);
    });
    return groups;
  }

  private formatStandaloneItem(item: ParsedItem): string {
    const confidence = this.getConfidenceEmoji(item.confidence);
    let text = `• ${item.rawContext}`;
    
    if (item.type === 'news' && 'summary' in item) {
      text = `• *${item.title}*\n  ${item.summary}`;
    } else if (item.type === 'debate' && 'topic' in item) {
      text = `• *${item.topic}*\n  ${item.whatWasDiscussed}`;
    } else if (item.type === 'dev' && 'title' in item) {
      text = `• *${item.title}*\n  ${item.whatChanged}`;
    }

    text += `\n  _📺 ${this.getChannelName(item.channelId)} ${confidence} • ⏱️ ${item.timestamp}_`;
    return text;
  }

  // Emoji and formatting helpers

  private getEntityEmoji(entityType: EntityGroup['entityType']): string {
    const emojis = {
      'product': '🚀',
      'company': '🏢',
      'person': '👤',
      'concept': '💡'
    };
    return emojis[entityType] || '📋';
  }

  private getCategoryEmoji(category: string): string {
    const emojis = {
      'launch': '🚀',
      'features': '✨',
      'technical': '⚙️',
      'ethical': '⚠️',
      'business': '💼',
      'criticism': '❌',
      'other': '📝'
    };
    return emojis[category] || '📝';
  }

  private getConfidenceEmoji(confidence: string): string {
    const emojis = {
      'high': '(H)',
      'medium': '(M)',
      'low': '(L)'
    };
    return emojis[confidence] || '(?)';
  }

  private formatCategory(category: string): string {
    const formatted = {
      'launch': 'Lansering',
      'features': 'Funksjoner',
      'technical': 'Teknisk',
      'ethical': 'Etiske aspekter',
      'business': 'Business',
      'criticism': 'Kritikk',
      'other': 'Annet'
    };
    return formatted[category] || category;
  }

  private formatItemType(type: string): string {
    const formatted = {
      'news': '📰 Nyheter',
      'debate': '💬 Debatt',
      'dev': '👨‍💻 Utvikling'
    };
    return formatted[type] || type;
  }

  private getChannelName(channelId: string): string {
    // Simple channel name mapping - could be enhanced with database lookup
    const channels = {
      'channel1': 'AI Daily Brief',
      'channel2': 'Matthew Berman',
      'channel3': 'MrEflow',
      'channel4': 'All In Podcast',
      'channel5': 'Last Week in AI'
    };
    return channels[channelId] || channelId;
  }
}
import { WebClient, Block } from '@slack/web-api';
import { 
  ClusteredBrief, 
  TopicCluster, 
  SubTopic, 
  ClusteredItem, 
  TLDRPoint 
} from '../types/clustering.types.js';
import { ParsedItem, NewsItem, DebateItem, DevItem } from '../types/schemas.js';

export interface EnhancedSlackBriefData {
  clusteredBrief: ClusteredBrief;
  runId: string;
  generatedAt: Date;
  stats: {
    totalVideos: number;
    totalItems: number;
    processingTimeMs: number;
    cost: number;
  };
}

export class EnhancedSlackFormatter {
  private slack: WebClient;
  private maxBlockLength: number = 2800; // Safe limit for Slack blocks

  constructor(slackToken: string) {
    this.slack = new WebClient(slackToken);
  }

  /**
   * Format clustered brief for Slack
   */
  async formatClusteredBrief(briefData: EnhancedSlackBriefData): Promise<Block[]> {
    const blocks: Block[] = [];
    const { clusteredBrief } = briefData;

    console.log(`📝 Formatting clustered brief: ${clusteredBrief.clusters.length} clusters, ${clusteredBrief.standaloneItems.length} standalone`);

    // Header with date and run info
    blocks.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🤖 AI NYHETSAGENT - ${this.formatDate(briefData.generatedAt)}`,
        emoji: true
      }
    });

    // Stats
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `📊 ${briefData.stats.totalVideos} videoer • ${briefData.stats.totalItems} items • ${clusteredBrief.clusters.length} temaer • ${Math.round(briefData.stats.processingTimeMs / 1000)}s • $${briefData.stats.cost.toFixed(4)}`
      }]
    });

    blocks.push({ type: 'divider' });

    // TL;DR Section
    if (clusteredBrief.tldr.length > 0) {
      blocks.push(...this.formatTLDRSection(clusteredBrief.tldr, clusteredBrief.stats));
      blocks.push({ type: 'divider' });
    }

    // Main clusters (sorted by relevance)
    const majorClusters = clusteredBrief.clusters
      .filter(cluster => cluster.itemCount >= 3)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    for (const cluster of majorClusters) {
      blocks.push(...await this.formatMajorTopic(cluster));
      blocks.push({ type: 'divider' });
    }

    // Minor clusters (2 items)
    const minorClusters = clusteredBrief.clusters
      .filter(cluster => cluster.itemCount === 2)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    if (minorClusters.length > 0) {
      blocks.push(...await this.formatMinorTopics(minorClusters));
      blocks.push({ type: 'divider' });
    }

    // Standalone items
    if (clusteredBrief.standaloneItems.length > 0) {
      blocks.push(...await this.formatStandaloneItems(clusteredBrief.standaloneItems));
    }

    return blocks;
  }

  /**
   * Format TL;DR section
   */
  private formatTLDRSection(tldrPoints: TLDRPoint[], stats: any): Block[] {
    const blocks: Block[] = [];

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*📊 TL;DR - DAGENS HOVEDPUNKTER*'
      }
    });

    const tldrContent = tldrPoints
      .map(point => {
        const emoji = this.getCategoryEmoji(point.category);
        return `${emoji} ${point.summary} (${point.sourceCount} ${point.sourceCount === 1 ? 'kilde' : 'kilder'})`;
      })
      .join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: tldrContent
      }
    });

    return blocks;
  }

  /**
   * Format major topic cluster (3+ items)
   */
  private async formatMajorTopic(cluster: TopicCluster): Promise<Block[]> {
    const blocks: Block[] = [];
    const emoji = this.getEntityEmoji(cluster.entityType);

    // Main topic header
    const headerText = `${emoji} *${cluster.mainEntity.toUpperCase()}*`;
    const subheaderText = this.generateClusterSubheader(cluster);

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${headerText}\n${subheaderText}`
      }
    });

    // Sub-topics
    for (const subTopic of cluster.subTopics) {
      if (subTopic.items.length > 0) {
        blocks.push(...await this.formatSubTopic(subTopic, cluster.mainEntity));
      }
    }

    // Source attributions
    const sourceText = this.formatSourceAttributions(cluster.sources);
    if (sourceText) {
      blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: sourceText
        }]
      });
    }

    return blocks;
  }

  /**
   * Format sub-topic within a cluster
   */
  private async formatSubTopic(subTopic: SubTopic, mainEntity: string): Promise<Block[]> {
    const blocks: Block[] = [];
    const categoryEmoji = this.getSubTopicEmoji(subTopic.category);
    const categoryName = this.getSubTopicName(subTopic.category);

    // Sub-topic header
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${categoryEmoji} *${categoryName}*`
      }
    });

    // Format items within sub-topic
    const itemTexts: string[] = [];
    
    for (const clusteredItem of subTopic.items.slice(0, 5)) { // Max 5 per sub-topic
      const itemText = await this.formatClusteredItem(clusteredItem);
      itemTexts.push(itemText);
    }

    // Split into blocks if needed
    const contentBlocks = this.splitIntoBlocks(itemTexts);
    contentBlocks.forEach(content => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: content
        }
      });
    });

    return blocks;
  }

  /**
   * Format individual clustered item
   */
  private async formatClusteredItem(clusteredItem: ClusteredItem): Promise<string> {
    const { originalItem, sourceDetails, uniqueAspects } = clusteredItem;
    
    const title = this.getItemTitle(originalItem);
    const summary = this.getItemSummary(originalItem);
    const confidence = this.getConfidenceIndicator(sourceDetails.confidence);
    
    // Add unique aspects if significant
    const uniqueText = uniqueAspects.length > 0 
      ? ` _${uniqueAspects[0]}_` 
      : '';

    const truncatedTitle = this.truncateText(title, 100);
    const truncatedSummary = this.truncateText(summary, 200);

    return `• *${truncatedTitle}*${uniqueText}\n${truncatedSummary}\n📺 ${sourceDetails.channel} • ${confidence}`;
  }

  /**
   * Format minor topics (2 items each)
   */
  private async formatMinorTopics(clusters: TopicCluster[]): Promise<Block[]> {
    const blocks: Block[] = [];

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*📰 ANDRE NYHETER*'
      }
    });

    const minorContent: string[] = [];

    for (const cluster of clusters.slice(0, 10)) { // Max 10 minor clusters
      const emoji = this.getEntityEmoji(cluster.entityType);
      const items = cluster.subTopics.flatMap(st => st.items).slice(0, 2);
      
      for (const clusteredItem of items) {
        const itemText = await this.formatClusteredItem(clusteredItem);
        minorContent.push(itemText);
      }
    }

    const contentBlocks = this.splitIntoBlocks(minorContent);
    contentBlocks.forEach(content => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: content
        }
      });
    });

    return blocks;
  }

  /**
   * Format standalone items
   */
  private async formatStandaloneItems(items: ParsedItem[]): Promise<Block[]> {
    const blocks: Block[] = [];

    if (items.length === 0) return blocks;

    // Group by type
    const newsItems = items.filter(item => 'summary' in item) as NewsItem[];
    const debateItems = items.filter(item => 'topic' in item) as DebateItem[];
    const devItems = items.filter(item => 'whatChanged' in item) as DevItem[];

    // Format each type
    if (newsItems.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*📰 ENKELTSTANDING NYHETER*'
        }
      });

      const newsContent = await Promise.all(
        newsItems
          .sort((a, b) => (b.relevance_score || 5) - (a.relevance_score || 5))
          .slice(0, 10) // Max 10 standalone news
          .map(item => this.formatNewsItem(item))
      );

      const newsBlocks = this.splitIntoBlocks(newsContent);
      newsBlocks.forEach(content => {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: content
          }
        });
      });
    }

    if (debateItems.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🧠 ENKELTSTANDING DEBATTER*'
        }
      });

      const debateContent = await Promise.all(
        debateItems
          .sort((a, b) => (b.relevance_score || 4) - (a.relevance_score || 4))
          .slice(0, 5) // Max 5 standalone debates
          .map(item => this.formatDebateItem(item))
      );

      const debateBlocks = this.splitIntoBlocks(debateContent);
      debateBlocks.forEach(content => {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: content
          }
        });
      });
    }

    if (devItems.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*👨‍💻 ENKELTSTANDING UTVIKLERINFO*'
        }
      });

      const devContent = await Promise.all(
        devItems
          .sort((a, b) => (b.relevance_score || 5) - (a.relevance_score || 5))
          .slice(0, 8) // Max 8 standalone dev items
          .map(item => this.formatDevItem(item))
      );

      const devBlocks = this.splitIntoBlocks(devContent);
      devBlocks.forEach(content => {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: content
          }
        });
      });
    }

    return blocks;
  }

  /**
   * Generate cluster subheader
   */
  private generateClusterSubheader(cluster: TopicCluster): string {
    const aspectCount = cluster.subTopics.length;
    const sourceCount = cluster.sources.length;
    
    return `_${cluster.itemCount} items • ${aspectCount} aspekter • ${sourceCount} kilder_`;
  }

  /**
   * Format source attributions
   */
  private formatSourceAttributions(sources: any[]): string {
    if (sources.length === 0) return '';
    
    const sourceTexts = sources
      .sort((a, b) => b.itemCount - a.itemCount)
      .slice(0, 5) // Max 5 sources
      .map(source => {
        const mainConfidence = this.getMostCommonConfidence(source.confidenceLevels);
        return `${source.channelName} (${source.itemCount})`;
      });

    return `📺 Kilder: ${sourceTexts.join(' • ')}`;
  }

  /**
   * Split content into blocks respecting length limits
   */
  private splitIntoBlocks(contents: string[]): string[] {
    const blocks: string[] = [];
    let currentBlock = '';

    for (const content of contents) {
      const potentialLength = currentBlock.length + content.length + 2; // +2 for newlines
      
      if (potentialLength > this.maxBlockLength && currentBlock.length > 0) {
        blocks.push(currentBlock.trim());
        currentBlock = content;
      } else {
        currentBlock += (currentBlock ? '\n\n' : '') + content;
      }
    }

    if (currentBlock.trim()) {
      blocks.push(currentBlock.trim());
    }

    return blocks;
  }

  // Format individual item types (fallback for standalone items)
  private async formatNewsItem(item: NewsItem): Promise<string> {
    const confidenceMap = { high: 'H', medium: 'M', low: 'L' };
    const confidence = confidenceMap[item.confidence];
    const title = this.truncateText(item.title, 120);
    const summary = this.truncateText(item.summary, 300);
    
    return `• *${title}*\n${summary}\n📺 Kilde • (${confidence})`;
  }

  private async formatDebateItem(item: DebateItem): Promise<string> {
    const topic = this.truncateText(item.topic, 100);
    const discussion = this.truncateText(item.whatWasDiscussed, 200);
    
    return `• *${topic}*\n${discussion}\n🎙️ Debatt`;
  }

  private async formatDevItem(item: DevItem): Promise<string> {
    const title = this.truncateText(item.title, 120);
    const changed = this.truncateText(item.whatChanged, 250);
    const action = this.getActionEmoji(item.developerAction);
    
    return `• *${title}*\n${changed}\n${action} ${item.developerAction}`;
  }

  // Helper methods
  private getEntityEmoji(entityType: string): string {
    const emojis = {
      product: '🚀',
      company: '🏢', 
      person: '👤',
      concept: '💡'
    };
    return emojis[entityType] || '📌';
  }

  private getSubTopicEmoji(category: string): string {
    const emojis = {
      launch: '🚀',
      features: '✨',
      technical: '🔧', 
      ethical: '⚖️',
      business: '💼',
      comparison: '⚡',
      criticism: '⚠️',
      other: '📝'
    };
    return emojis[category] || '📝';
  }

  private getSubTopicName(category: string): string {
    const names = {
      launch: 'LANSERING',
      features: 'FUNKSJONER',
      technical: 'TEKNISK',
      ethical: 'ETIKK & BEKYMRINGER',
      business: 'BUSINESS',
      comparison: 'SAMMENLIGNINGER', 
      criticism: 'KRITIKK',
      other: 'ANDRE ASPEKTER'
    };
    return names[category] || 'OPPDATERINGER';
  }

  private getCategoryEmoji(category: string): string {
    const emojis = {
      breaking: '🚨',
      major: '📈',
      notable: '📌'
    };
    return emojis[category] || '📌';
  }

  private getActionEmoji(action: string): string {
    const emojis = {
      try: '🧪',
      update: '🔄',
      evaluate: '🔍',
      migrate: '🔀',
      test: '✅',
      learn: '📚'
    };
    return emojis[action] || '⚡';
  }

  private getConfidenceIndicator(confidence: string): string {
    const indicators = { high: 'H', medium: 'M', low: 'L' };
    return indicators[confidence] || 'M';
  }

  private getMostCommonConfidence(confidences: string[]): string {
    const counts = confidences.reduce((acc, conf) => {
      acc[conf] = (acc[conf] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return Object.entries(counts)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || 'M';
  }

  private getItemTitle(item: ParsedItem): string {
    if ('title' in item && item.title) return item.title;
    if ('topic' in item && item.topic) return item.topic;
    return 'Untitled';
  }

  private getItemSummary(item: ParsedItem): string {
    if ('summary' in item && item.summary) return item.summary;
    if ('whatWasDiscussed' in item && item.whatWasDiscussed) return item.whatWasDiscussed;
    if ('whatChanged' in item && item.whatChanged) return item.whatChanged;
    return '';
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('no-NO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  /**
   * Send clustered brief to Slack
   */
  async sendClusteredBrief(briefData: EnhancedSlackBriefData, channelId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const blocks = await this.formatClusteredBrief(briefData);
      
      console.log(`📤 Sending enhanced brief with ${blocks.length} blocks to Slack`);

      const result = await this.slack.chat.postMessage({
        channel: channelId,
        blocks,
        text: `AI Nyhetsagent Brief - ${briefData.generatedAt.toDateString()}` // Fallback text
      });

      if (result.ok) {
        return { success: true };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('Slack posting error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}
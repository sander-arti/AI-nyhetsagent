import { WebClient } from '@slack/web-api';
import { NewsItem, DebateItem, DevItem } from '../types/schemas.js';
import { getDatabase } from '../db/database.js';

export interface SlackBriefData {
  newsItems: NewsItem[];
  debateItems: DebateItem[];
  devItems: DevItem[];
  runId: string;
  generatedAt: Date;
  stats: {
    totalVideos: number;
    totalItems: number;
    processingTimeMs: number;
    cost: number;
  };
}

export interface SlackPostResult {
  success: boolean;
  channelId?: string;
  timestamp?: string;
  error?: string;
}

export class SlackService {
  private client: WebClient;
  private db;

  constructor(token: string) {
    this.client = new WebClient(token);
    this.db = getDatabase();
  }

  /**
   * Send AI brief to Slack channel
   */
  async sendBrief(briefData: SlackBriefData, channelId: string): Promise<SlackPostResult> {
    try {
      // Check for existing post to ensure idempotency
      const existingPost = await this.getExistingPost(briefData.runId, channelId);
      if (existingPost) {
        console.log(`📤 Brief already sent to ${channelId} for run ${briefData.runId}`);
        return {
          success: true,
          channelId,
          timestamp: existingPost.thread_ts
        };
      }

      // Build Slack blocks
      const blocks = await this.buildSlackBlocks(briefData);

      // Send message
      console.log(`📤 Sending AI brief to channel ${channelId}`);
      const result = await this.client.chat.postMessage({
        channel: channelId,
        blocks,
        text: `ARTI AI-brief • ${this.formatDate(briefData.generatedAt)}`, // Fallback text
        unfurl_links: false,
        unfurl_media: false
      });

      if (result.ok && result.ts) {
        // Save post record for idempotency
        await this.savePostRecord(briefData.runId, channelId, result.ts);
        
        console.log(`✅ Brief sent successfully to ${channelId}`);
        return {
          success: true,
          channelId,
          timestamp: result.ts
        };
      } else {
        throw new Error(`Slack API error: ${result.error}`);
      }

    } catch (error) {
      console.error(`❌ Failed to send brief to ${channelId}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Build Slack Block Kit message
   */
  private async buildSlackBlocks(briefData: SlackBriefData) {
    const blocks: any[] = [];
    const date = this.formatDate(briefData.generatedAt);

    // Header
    blocks.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🤖 ARTI AI-brief • ${date}`,
        emoji: true
      }
    });

    // Stats divider
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `📊 ${briefData.stats.totalVideos} videoer • ${briefData.stats.totalItems} items • ${Math.round(briefData.stats.processingTimeMs / 1000)}s • $${briefData.stats.cost.toFixed(4)}`
        }
      ]
    });

    blocks.push({ type: 'divider' });

    // Del 1: 📰 Siste nytt
    if (briefData.newsItems.length > 0) {
      // Filter by relevance score and sort
      const relevantNewsItems = briefData.newsItems
        .filter(item => (item.relevance_score || 5) >= 5) // Only show relevant items
        .sort((a, b) => {
          // Sort by confidence (high > medium > low)
          const confidenceOrder = { high: 3, medium: 2, low: 1 };
          const aScore = confidenceOrder[a.confidence] || 0;
          const bScore = confidenceOrder[b.confidence] || 0;
          
          if (aScore !== bScore) return bScore - aScore;
          
          // If same confidence, sort by relevance_score
          const aRelevance = a.relevance_score || 0;
          const bRelevance = b.relevance_score || 0;
          return bRelevance - aRelevance;
        });

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📰 SISTE NYTT* (${relevantNewsItems.length})`
        }
      });

      // Format all relevant items (no artificial limit)
      const formattedNewsItems = await Promise.all(
        relevantNewsItems.map(item => this.formatNewsItem(item))
      );

      // Split into multiple blocks if needed
      const newsBlocks = this.splitIntoBlocks(formattedNewsItems);
      newsBlocks.forEach((blockContent) => {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: blockContent
          }
        });
      });

      blocks.push({ type: 'divider' });
    }

    // Del 2: 🧠 Temaer & debatter
    if (briefData.debateItems.length > 0) {
      // Filter by relevance score
      const relevantDebateItems = briefData.debateItems
        .filter(item => (item.relevance_score || 4) >= 4) // Slightly lower threshold for debates
        .sort((a, b) => {
          // Sort by relevance_score primarily
          const aRelevance = a.relevance_score || 0;
          const bRelevance = b.relevance_score || 0;
          return bRelevance - aRelevance;
        });

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🧠 TEMAER & DEBATTER* (${relevantDebateItems.length})`
        }
      });

      // Format all relevant debate items
      const formattedDebateItems = await Promise.all(
        relevantDebateItems.map(item => this.formatDebateItem(item))
      );

      // Split into multiple blocks if needed
      const debateBlocks = this.splitIntoBlocks(formattedDebateItems);
      debateBlocks.forEach((blockContent) => {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: blockContent
          }
        });
      });

      blocks.push({ type: 'divider' });
    }

    // Del 3: 🛠️ For utviklere
    if (briefData.devItems.length > 0) {
      // Filter by relevance score
      const relevantDevItems = briefData.devItems
        .filter(item => (item.relevance_score || 5) >= 5) // Focus on practical utility
        .sort((a, b) => {
          // Sort by relevance_score primarily
          const aRelevance = a.relevance_score || 0;
          const bRelevance = b.relevance_score || 0;
          return bRelevance - aRelevance;
        });

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🛠️ FOR UTVIKLERE* (${relevantDevItems.length})`
        }
      });

      // Format all relevant dev items
      const formattedDevItems = await Promise.all(
        relevantDevItems.map(item => this.formatDevItem(item))
      );

      // Split into multiple blocks if needed
      const devBlocks = this.splitIntoBlocks(formattedDevItems);
      devBlocks.forEach((blockContent) => {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: blockContent
          }
        });
      });

      blocks.push({ type: 'divider' });
    }

    // Deep-dives å vurdere (items with recommendedDeepDive flag)
    const deepDiveItems = briefData.debateItems.filter(item => item.recommendedDeepDive);
    if (deepDiveItems.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🔍 Deep-dives å vurdere* (${deepDiveItems.length})`
        }
      });

      // Format all deep-dive items (no artificial limit)
      const formattedDeepDiveItems = deepDiveItems.map(item => 
        `• *${this.truncateText(item.topic, 150)}* - ${this.truncateText(item.implications, 400)} ${this.formatSourceLink(item)}`
      );

      // Split into multiple blocks if needed
      const deepDiveBlocks = this.splitIntoBlocks(formattedDeepDiveItems);
      deepDiveBlocks.forEach((blockContent) => {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: blockContent
          }
        });
      });
    }

    // Footer with enhanced stats
    const totalItemsShown = (briefData.newsItems.filter(item => (item.relevance_score || 5) >= 5).length) +
                            (briefData.debateItems.filter(item => (item.relevance_score || 4) >= 4).length) +
                            (briefData.devItems.filter(item => (item.relevance_score || 5) >= 5).length) +
                            (briefData.debateItems.filter(item => item.recommendedDeepDive).length);

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🤖 Generert automatisk • ${briefData.runId} • ${totalItemsShown} items vist i ${blocks.length} blocks`
        }
      ]
    });

    return blocks;
  }

  /**
   * Format news item according to PRD template
   */
  private async formatNewsItem(item: NewsItem): Promise<string> {
    const confidenceMap = { high: 'H', medium: 'M', low: 'L' };
    const confidence = confidenceMap[item.confidence];
    const title = this.truncateText(item.title, 120);
    const summary = this.truncateText(item.summary, 350);
    const sourceInfo = await this.formatSourceInfo(item);
    
    return `• *${title}*\n${summary}\n📺 ${sourceInfo} • (${confidence})`;
  }

  /**
   * Format debate item according to PRD template
   */
  private async formatDebateItem(item: DebateItem): Promise<string> {
    const proPoints = item.positions.pro?.join(', ') || '';
    const contraPoints = item.positions.contra?.join(', ') || '';
    const perspectives = [];
    
    if (proPoints) perspectives.push(`Pro: ${this.truncateText(proPoints, 180)}`);
    if (contraPoints) perspectives.push(`Contra: ${this.truncateText(contraPoints, 180)}`);
    
    const perspectiveText = perspectives.join(' | ');
    const topic = this.truncateText(item.topic, 100);
    const whatDiscussed = this.truncateText(item.whatWasDiscussed, 250);
    const implications = this.truncateText(item.implications, 300);
    const sourceInfo = await this.formatSourceInfo(item);

    return `• *${topic}*\n*Diskutert:* ${whatDiscussed}\n*Perspektiver:* ${perspectiveText}\n*Implikasjoner:* ${implications}\n📺 ${sourceInfo}`;
  }

  /**
   * Format dev item according to PRD template
   */
  private async formatDevItem(item: DevItem): Promise<string> {
    const confidenceMap = { high: 'H', medium: 'M', low: 'L' };
    const confidence = confidenceMap[item.confidence];
    const action = this.formatDeveloperAction(item.developerAction);
    const title = this.truncateText(item.title, 120);
    const whatChanged = this.truncateText(item.whatChanged, 300);
    const sourceInfo = await this.formatSourceInfo(item);

    return `• *${title}*\n${whatChanged}\n*Handling:* ${action} • (${confidence})\n📺 ${sourceInfo}`;
  }

  /**
   * Format developer action
   */
  private formatDeveloperAction(action: string): string {
    const actionMap = {
      try: '🚀 Prøv ut',
      update: '🔄 Oppdater',
      evaluate: '🤔 Vurder',
      migrate: '📦 Migrer', 
      test: '🧪 Test',
      learn: '📚 Lær'
    };
    return actionMap[action] || action;
  }

  /**
   * Format source link with video URL
   */
  private formatSourceLink(item: NewsItem | DebateItem | DevItem): string {
    return `<${item.sourceUrl}|📺>`;
  }

  /**
   * Format source info with channel and YouTube link
   */
  private async formatSourceInfo(item: NewsItem | DebateItem | DevItem): Promise<string> {
    // Get channel name from database
    const channelName = await this.getChannelName(item.channelId);
    const youtubeUrl = item.sourceUrl || `https://youtube.com/watch?v=${item.videoId}`;
    
    return `${channelName} • <${youtubeUrl}|Se video>`;
  }

  /**
   * Get channel name from database using channel ID
   */
  private async getChannelName(channelId: string): Promise<string> {
    try {
      const rows = await this.db.query(
        'SELECT name FROM sources WHERE channel_id = ? AND active = 1',
        [channelId]
      );
      
      return rows.length > 0 ? rows[0].name : 'AI Kanal';
    } catch (error) {
      console.error('Error getting channel name:', error);
      return 'AI Kanal';
    }
  }

  /**
   * Format date in Norwegian format
   */
  private formatDate(date: Date): string {
    return date.toLocaleDateString('nb-NO', {
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric'
    });
  }

  /**
   * Truncate text to avoid Slack Block Kit limits
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Split items into multiple blocks to handle unlimited content
   */
  private splitIntoBlocks(items: string[], maxCharsPerBlock: number = 2900): string[] {
    const blocks: string[] = [];
    let currentBlock = '';
    
    for (const item of items) {
      // Check if adding this item would exceed the limit
      const potentialLength = currentBlock.length + (currentBlock ? 2 : 0) + item.length; // +2 for \n\n
      
      if (potentialLength > maxCharsPerBlock && currentBlock) {
        // Save current block and start a new one
        blocks.push(currentBlock);
        currentBlock = item;
      } else {
        // Add to current block
        currentBlock += currentBlock ? '\n\n' + item : item;
      }
    }
    
    // Add the final block if not empty
    if (currentBlock) {
      blocks.push(currentBlock);
    }
    
    return blocks.length > 0 ? blocks : [''];
  }

  /**
   * Check for existing post (idempotency)
   */
  private async getExistingPost(runId: string, channelId: string): Promise<any> {
    try {
      const rows = await this.db.query(
        'SELECT * FROM slack_posts WHERE run_id = ? AND channel_id = ?',
        [runId, channelId]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error checking existing post:', error);
      return null;
    }
  }

  /**
   * Save post record for idempotency
   */
  private async savePostRecord(runId: string, channelId: string, timestamp: string): Promise<void> {
    try {
      // For test runs, skip saving to avoid foreign key constraint
      if (runId.startsWith('test_')) {
        console.log('🧪 Skipping post record save for test run');
        return;
      }
      
      await this.db.run(`
        INSERT INTO slack_posts (run_id, channel_id, thread_ts, status)
        VALUES (?, ?, ?, 'posted')
      `, [runId, channelId, timestamp]);
    } catch (error) {
      console.error('Error saving post record:', error);
    }
  }

  /**
   * Send direct message to user (for error notifications)
   */
  async sendDirectMessage(userId: string, message: string): Promise<SlackPostResult> {
    try {
      const result = await this.client.chat.postMessage({
        channel: userId,
        text: message,
        unfurl_links: false
      });

      if (result.ok) {
        return { success: true, channelId: userId, timestamp: result.ts };
      } else {
        throw new Error(`Slack API error: ${result.error}`);
      }

    } catch (error) {
      console.error(`Failed to send DM to ${userId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get channel information
   */
  async getChannelInfo(channelId: string): Promise<any> {
    try {
      const result = await this.client.conversations.info({
        channel: channelId
      });
      return result.ok ? result.channel : null;
    } catch (error) {
      console.error(`Failed to get channel info for ${channelId}:`, error);
      return null;
    }
  }

  /**
   * Test Slack connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const result = await this.client.auth.test();
      return result.ok === true;
    } catch {
      return false;
    }
  }

  /**
   * Get usage statistics
   */
  async getSlackStats(): Promise<{
    totalPosts: number;
    successRate: number;
    lastPostAt?: Date;
  }> {
    const stats = await this.db.query(`
      SELECT 
        COUNT(*) as total_posts,
        SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) as successful_posts,
        MAX(posted_at) as last_post_at
      FROM slack_posts
    `);

    const row = stats[0] || {};
    return {
      totalPosts: row.total_posts || 0,
      successRate: row.total_posts > 0 ? (row.successful_posts || 0) / row.total_posts : 0,
      lastPostAt: row.last_post_at ? new Date(row.last_post_at) : undefined
    };
  }
}
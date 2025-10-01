import { YouTubeService } from './youtube.service.js';
import { TranscriptProcessor } from '../processors/transcript.processor.js';
import { ItemProcessor } from '../processors/item.processor.js';
import { DedupProcessor } from '../processors/dedup.processor.js';
import { SlackService, SlackBriefData } from './slack.service.js';
import { getDatabase } from '../db/database.js';
import { NewsItem, DebateItem, DevItem } from '../types/schemas.js';

export interface OrchestratorConfig {
  youtubeApiKey: string;
  openaiApiKey: string;
  slackBotToken: string;
  slackChannelId: string;
  maxVideosPerSource?: number;
  maxTranscriptionMinutes?: number;
  similarityThreshold?: number;
  lookbackHours?: number;
  dryRun?: boolean;
  rapidApiKey?: string;
  rapidApiHost?: string;
  rapidApiRateLimit?: number;
}

export interface RunStats {
  runId: string;
  startedAt: Date;
  finishedAt?: Date;
  status: 'running' | 'success' | 'failed';
  stats: {
    sourcesProcessed: number;
    videosFound: number;
    videosTranscribed: number;
    itemsExtracted: number;
    itemsAfterDedup: number;
    duplicatesRemoved: number;
    totalProcessingTimeMs: number;
    totalCost: number;
  };
  errors: string[];
}

export class OrchestratorService {
  private youtubeService: YouTubeService;
  private transcriptProcessor: TranscriptProcessor;
  private itemProcessor: ItemProcessor;
  private dedupProcessor: DedupProcessor;
  private slackService: SlackService;
  private db;
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.youtubeService = new YouTubeService(config.youtubeApiKey);
    this.transcriptProcessor = new TranscriptProcessor(
      config.openaiApiKey,
      config.maxTranscriptionMinutes || 180,
      config.rapidApiKey,
      config.rapidApiHost,
      config.rapidApiRateLimit
    );
    this.itemProcessor = new ItemProcessor(config.openaiApiKey);
    this.dedupProcessor = new DedupProcessor(config.openaiApiKey);
    this.slackService = new SlackService(config.slackBotToken);
    this.db = getDatabase();
  }

  /**
   * Main orchestration method - runs complete pipeline
   */
  async runPipeline(): Promise<RunStats> {
    const runId = `run_${Date.now()}`;
    const startTime = Date.now();
    
    const runStats: RunStats = {
      runId,
      startedAt: new Date(),
      status: 'running',
      stats: {
        sourcesProcessed: 0,
        videosFound: 0,
        videosTranscribed: 0,
        itemsExtracted: 0,
        itemsAfterDedup: 0,
        duplicatesRemoved: 0,
        totalProcessingTimeMs: 0,
        totalCost: 0
      },
      errors: []
    };

    try {
      console.log(`🚀 Starting AI-nyhetsagent pipeline - Run ID: ${runId}`);
      
      // Save run record
      await this.saveRunRecord(runStats);

      // Step 1: Get active sources and find new videos
      console.log('📡 Step 1: Fetching new videos from sources...');
      const { newVideos, sourcesProcessed } = await this.fetchNewVideos();
      
      runStats.stats.sourcesProcessed = sourcesProcessed;
      runStats.stats.videosFound = newVideos.length;
      
      if (newVideos.length === 0) {
        console.log('ℹ️ No new videos found since last run');
        return await this.finishRun(runStats, 'success');
      }

      console.log(`📹 Found ${newVideos.length} new videos across ${sourcesProcessed} sources`);

      // Step 2: Process transcripts
      console.log('\n📝 Step 2: Processing transcripts...');
      const { processedVideos, transcriptionCost } = await this.processTranscripts(newVideos);
      
      runStats.stats.videosTranscribed = processedVideos.length;
      runStats.stats.totalCost += transcriptionCost;

      // Step 3: Extract items from transcripts
      console.log('\n🧠 Step 3: Extracting structured items...');
      const { allItems, extractionCost } = await this.extractItems(processedVideos);
      
      runStats.stats.itemsExtracted = allItems.length;
      runStats.stats.totalCost += extractionCost;

      // Step 4: Deduplication
      console.log('\n🔍 Step 4: Deduplicating items...');
      const { deduplicatedItems, duplicatesRemoved, dedupCost } = await this.deduplicateItems(allItems);
      
      runStats.stats.itemsAfterDedup = deduplicatedItems.length;
      runStats.stats.duplicatesRemoved = duplicatesRemoved;
      runStats.stats.totalCost += dedupCost;

      // Step 5: Send Slack brief (if not dry run)
      if (!this.config.dryRun) {
        console.log('\n📤 Step 5: Sending Slack brief...');
        await this.sendSlackBrief(deduplicatedItems, runStats);
      } else {
        console.log('\n🧪 Step 5: Dry run - skipping Slack posting');
        console.log(`📋 Would send brief with ${deduplicatedItems.length} items`);
      }

      // Step 6: Update last run timestamp
      await this.updateLastRunTimestamp();

      return await this.finishRun(runStats, 'success');

    } catch (error) {
      console.error('❌ Pipeline failed:', error);
      runStats.errors.push(error.message);
      return await this.finishRun(runStats, 'failed');
    }
  }

  /**
   * Fetch new videos from all active sources
   */
  private async fetchNewVideos(): Promise<{ newVideos: any[]; sourcesProcessed: number }> {
    const sources = await this.db.query('SELECT * FROM sources WHERE active = 1');
    const newVideos: any[] = [];
    let sourcesProcessed = 0;

    for (const source of sources) {
      try {
        console.log(`📡 Checking ${source.name}...`);
        
        // Skip sources without channel_id
        if (!source.channel_id || source.channel_id === '') {
          console.log(`  ⚠️ Skipping - missing channel_id`);
          continue;
        }
        
        // Get lookback date for filtering videos
        const lookbackDate = this.getLookbackDate();
        
        // Fetch recent videos from YouTube
        const videos = await this.youtubeService.getChannelVideos(
          source.channel_id,
          this.config.maxVideosPerSource || 10
        );

        // Filter for videos published within the lookback window
        const recentVideos = videos.filter(video => {
          const publishedAt = new Date(video.publishedAt);
          return publishedAt > lookbackDate;
        });

        // Check which videos are already in database
        let existingCount = 0;
        const newVideosFromSource = [];
        
        for (const video of recentVideos) {
          const exists = await this.isVideoInDatabase(video.id);
          if (exists) {
            existingCount++;
          } else {
            // Save new video to database
            await this.saveVideoToDatabase(video, source);
            newVideosFromSource.push({ ...video, sourceId: source.id, sourceType: source.type });
          }
        }
        
        newVideos.push(...newVideosFromSource);

        sourcesProcessed++;
        console.log(`  📊 YouTube: ${videos.length} total, ${recentVideos.length} recent, ${existingCount} existing, ${newVideosFromSource.length} new`);

      } catch (error) {
        console.error(`⚠️ Error processing source ${source.name}:`, error.message);
      }
    }

    return { newVideos, sourcesProcessed };
  }

  /**
   * Process transcripts for videos
   */
  private async processTranscripts(videos: any[]): Promise<{ processedVideos: any[]; transcriptionCost: number }> {
    const processedVideos: any[] = [];
    let transcriptionCost = 0;

    for (const video of videos) {
      try {
        console.log(`📝 Processing: ${video.title}`);
        
        const transcript = await this.transcriptProcessor.processVideoTranscript(video);
        
        if (transcript) {
          processedVideos.push({ ...video, transcript });
          transcriptionCost += transcript.cost || 0;
        }

      } catch (error) {
        console.error(`⚠️ Transcript failed for ${video.title}:`, error.message);
      }
    }

    return { processedVideos, transcriptionCost };
  }

  /**
   * Extract structured items from transcripts
   */
  private async extractItems(videos: any[]): Promise<{ allItems: any[]; extractionCost: number }> {
    const allItems: any[] = [];
    let extractionCost = 0;

    for (const video of videos) {
      try {
        const videoMetadata = {
          id: video.id,
          title: video.title,
          channelId: video.sourceId,
          channelName: video.channelTitle,
          duration: video.duration,
          publishedAt: new Date(video.publishedAt),
          url: `https://www.youtube.com/watch?v=${video.id}`
        };

        const result = await this.itemProcessor.processVideo(
          videoMetadata,
          video.transcript
        );

        // Collect all items regardless of type
        const items = [
          ...(result.newsItems || []),
          ...(result.debateItems || []),
          ...(result.devItems || [])
        ];

        allItems.push(...items);
        extractionCost += result.estimatedCost || 0;

      } catch (error) {
        console.error(`⚠️ Item extraction failed for ${video.title}:`, error.message);
      }
    }

    return { allItems, extractionCost };
  }

  /**
   * Deduplicate items across sources
   */
  private async deduplicateItems(items: any[]): Promise<{ 
    deduplicatedItems: any[];
    duplicatesRemoved: number;
    dedupCost: number;
  }> {
    if (items.length === 0) {
      return { deduplicatedItems: [], duplicatesRemoved: 0, dedupCost: 0 };
    }

    const result = await this.dedupProcessor.deduplicateItems(
      items,
      this.config.similarityThreshold || 0.85
    );

    return {
      deduplicatedItems: result.deduplicatedItems,
      duplicatesRemoved: result.duplicatesRemoved,
      dedupCost: result.processing_stats.embedding_cost
    };
  }

  /**
   * Send Slack brief with deduplicated items
   */
  private async sendSlackBrief(items: any[], runStats: RunStats): Promise<void> {
    // Group items by type
    const newsItems: NewsItem[] = [];
    const debateItems: DebateItem[] = [];
    const devItems: DevItem[] = [];

    items.forEach(item => {
      if ('summary' in item && 'entities' in item) {
        newsItems.push(item as NewsItem);
      } else if ('topic' in item && 'whatWasDiscussed' in item) {
        debateItems.push(item as DebateItem);
      } else if ('whatChanged' in item && 'developerAction' in item) {
        devItems.push(item as DevItem);
      }
    });

    const briefData: SlackBriefData = {
      newsItems,
      debateItems,
      devItems,
      runId: runStats.runId,
      generatedAt: new Date(),
      stats: {
        totalVideos: runStats.stats.videosTranscribed,
        totalItems: items.length,
        processingTimeMs: Date.now() - runStats.startedAt.getTime(),
        cost: runStats.stats.totalCost
      }
    };

    const result = await this.slackService.sendBrief(briefData, this.config.slackChannelId);
    
    if (!result.success) {
      throw new Error(`Slack posting failed: ${result.error}`);
    }

    console.log('✅ Slack brief sent successfully');
  }

  /**
   * Check if video already exists in database
   */
  private async isVideoInDatabase(videoId: string): Promise<boolean> {
    const rows = await this.db.query(`
      SELECT 1 FROM videos WHERE video_id = ? LIMIT 1
    `, [videoId]);
    
    return rows.length > 0;
  }

  /**
   * Save video to database
   */
  private async saveVideoToDatabase(video: any, source: any): Promise<void> {
    await this.db.run(`
      INSERT OR IGNORE INTO videos (
        video_id, source_id, title, duration_seconds, published_at, url
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [
      video.id,
      source.id,
      video.title,
      video.duration,
      new Date(video.publishedAt).toISOString(),
      `https://www.youtube.com/watch?v=${video.id}`
    ]);
  }

  /**
   * Save run record to database
   */
  private async saveRunRecord(runStats: RunStats): Promise<void> {
    await this.db.run(`
      INSERT INTO runs (id, started_at, status, stats)
      VALUES (?, ?, ?, ?)
    `, [
      runStats.runId,
      runStats.startedAt.toISOString(),
      runStats.status,
      JSON.stringify(runStats.stats)
    ]);
  }

  /**
   * Finish run and update database
   */
  private async finishRun(runStats: RunStats, status: 'success' | 'failed'): Promise<RunStats> {
    runStats.finishedAt = new Date();
    runStats.status = status;
    runStats.stats.totalProcessingTimeMs = runStats.finishedAt.getTime() - runStats.startedAt.getTime();

    await this.db.run(`
      UPDATE runs 
      SET finished_at = ?, status = ?, stats = ?, error_log = ?
      WHERE id = ?
    `, [
      runStats.finishedAt.toISOString(),
      status,
      JSON.stringify(runStats.stats),
      runStats.errors.length > 0 ? JSON.stringify(runStats.errors) : null,
      runStats.runId
    ]);

    const duration = Math.round(runStats.stats.totalProcessingTimeMs / 1000);
    const statusIcon = status === 'success' ? '✅' : '❌';
    
    console.log(`\n${statusIcon} Pipeline ${status} - Run ID: ${runStats.runId}`);
    console.log(`⏱️ Duration: ${duration}s`);
    console.log(`💰 Total cost: $${runStats.stats.totalCost.toFixed(4)}`);
    console.log(`📊 Final stats:`);
    console.log(`   ${runStats.stats.sourcesProcessed} sources processed`);
    console.log(`   ${runStats.stats.videosFound} videos found`);
    console.log(`   ${runStats.stats.videosTranscribed} transcribed`);
    console.log(`   ${runStats.stats.itemsExtracted} items extracted`);
    console.log(`   ${runStats.stats.duplicatesRemoved} duplicates removed`);
    console.log(`   ${runStats.stats.itemsAfterDedup} final items`);

    return runStats;
  }

  /**
   * Get lookback date for finding videos within the specified time window
   */
  private getLookbackDate(): Date {
    const lookbackHours = this.config.lookbackHours || 24;
    const lookbackMs = lookbackHours * 60 * 60 * 1000;
    return new Date(Date.now() - lookbackMs);
  }

  /**
   * Update last run timestamp for next execution
   */
  private async updateLastRunTimestamp(): Promise<void> {
    // This could be stored in a separate settings table
    // For now, we rely on the runs table
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.transcriptProcessor.cleanup();
    await this.itemProcessor.cleanup();
    await this.dedupProcessor.cleanup();
    await this.db.close();
  }
}
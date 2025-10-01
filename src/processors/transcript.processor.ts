import { WhisperService } from '../services/whisper.service.js';
import { getDatabase } from '../db/database.js';
import { VideoMetadata } from '../types/youtube.types.js';

export interface ProcessedTranscript {
  videoId: string;
  text: string;
  segments: TranscriptSegment[];
  language: string;
  source: 'whisper';
  qualityScore: number;
  duration: number;
  cost?: number;
}

export interface TranscriptSegment {
  start: number; // seconds
  end: number;   // seconds  
  text: string;
}

export class TranscriptProcessor {
  private whisperService: WhisperService;
  private db;

  constructor(openaiApiKey: string, maxWhisperMinutes: number = 180) {
    this.whisperService = new WhisperService(openaiApiKey, maxWhisperMinutes);
    this.db = getDatabase();
  }

  /**
   * Main method: Get transcript for video with automatic fallback
   */
  async processVideoTranscript(video: VideoMetadata): Promise<ProcessedTranscript | null> {
    const { id: videoId, title, duration } = video;
    
    console.log(`📝 Processing transcript for: ${title}`);

    // Check if transcript already exists
    const existingTranscript = await this.getExistingTranscript(videoId);
    if (existingTranscript) {
      console.log(`✅ Using existing transcript (${existingTranscript.source})`);
      return existingTranscript;
    }

    // Transcribe with Whisper API
    let processedTranscript: ProcessedTranscript | null = null;
    const durationMinutes = duration / 60;
    
    // Check if we can afford to transcribe this video
    if (!this.whisperService.canTranscribe(durationMinutes)) {
      const usage = this.whisperService.getUsageStats();
      console.log(`⚠ Skipping ${title}: Would exceed Whisper limit`);
      console.log(`   Duration: ${durationMinutes.toFixed(1)}min, Remaining: ${usage.minutesRemaining.toFixed(1)}min`);
      return null;
    }

    const estimatedCost = this.whisperService.estimateCost(durationMinutes);
    console.log(`💰 Estimated cost: $${estimatedCost.toFixed(3)} (${durationMinutes.toFixed(1)} min)`);

    try {
      const whisperResult = await this.whisperService.transcribeVideo(videoId, title, duration);
      
      if (whisperResult) {
        processedTranscript = {
          videoId,
          text: whisperResult.text,
          segments: whisperResult.segments?.map(seg => ({
            start: seg.start,
            end: seg.end,
            text: seg.text,
          })) || [],
          language: whisperResult.language,
          source: 'whisper',
          qualityScore: this.calculateWhisperQualityScore(whisperResult.text, duration),
          duration,
        };
        
        console.log(`✅ Whisper transcription complete (${whisperResult.language})`);
      }
    } catch (error) {
      console.error(`❌ Whisper transcription failed for ${videoId}:`, error);
      return null;
    }

    // Save transcript to database
    if (processedTranscript) {
      await this.saveTranscript(processedTranscript);
      console.log(`💾 Transcript saved to database`);
    }

    return processedTranscript;
  }

  /**
   * Check if transcript already exists in database
   */
  private async getExistingTranscript(videoId: string): Promise<ProcessedTranscript | null> {
    try {
      const rows = await this.db.query(`
        SELECT t.*, v.duration_seconds
        FROM transcripts t
        JOIN videos v ON t.video_id = v.id
        WHERE v.video_id = ?
      `, [videoId]);

      if (rows.length === 0) return null;

      const row = rows[0];
      const segments = row.segments ? JSON.parse(row.segments) : [];

      return {
        videoId,
        text: row.text,
        segments,
        language: row.language || 'unknown',
        source: 'whisper',
        qualityScore: row.quality_score || 0.5,
        duration: row.duration_seconds || 0,
      };
    } catch (error) {
      console.error('Error checking existing transcript:', error);
      return null;
    }
  }

  /**
   * Save transcript to database
   */
  private async saveTranscript(transcript: ProcessedTranscript): Promise<void> {
    try {
      // First get the internal video ID from video_id
      const videoRows = await this.db.query(
        'SELECT id FROM videos WHERE video_id = ?', 
        [transcript.videoId]
      );

      if (videoRows.length === 0) {
        throw new Error(`Video not found in database: ${transcript.videoId}`);
      }

      const internalVideoId = videoRows[0].id;

      // Insert transcript
      await this.db.run(`
        INSERT OR REPLACE INTO transcripts (video_id, text, segments, quality_score)
        VALUES (?, ?, ?, ?)
      `, [
        internalVideoId,
        transcript.text,
        JSON.stringify(transcript.segments),
        transcript.qualityScore,
      ]);

      // Update video with transcript info
      await this.db.run(`
        UPDATE videos 
        SET transcript_source = ?, language = ?
        WHERE video_id = ?
      `, [transcript.source, transcript.language, transcript.videoId]);

    } catch (error) {
      console.error('Error saving transcript:', error);
      throw error;
    }
  }

  /**
   * Calculate quality score for Whisper transcripts
   */
  private calculateWhisperQualityScore(text: string, duration: number): number {
    // Basic heuristics for transcript quality
    const wordCount = text.split(' ').length;
    const wordsPerMinute = wordCount / (duration / 60);
    
    // Typical speaking rate is 150-200 wpm
    // Lower or higher rates might indicate poor transcription
    let qualityScore = 0.7; // Base score for Whisper
    
    if (wordsPerMinute >= 100 && wordsPerMinute <= 250) {
      qualityScore += 0.1; // Reasonable speaking rate
    }
    
    if (text.length > 100) {
      qualityScore += 0.05; // Not too short
    }
    
    // Penalty for lots of [Music], [Applause], etc.
    const bracketsCount = (text.match(/\[.*?\]/g) || []).length;
    const bracketsRatio = bracketsCount / wordCount;
    if (bracketsRatio > 0.1) {
      qualityScore -= 0.2; // Lots of non-speech content
    }
    
    return Math.max(0.1, Math.min(1.0, qualityScore));
  }

  /**
   * Get transcript processing statistics
   */
  async getProcessingStats(): Promise<{
    totalTranscripts: number;
    captionsCount: number;
    whisperCount: number;
    averageQuality: number;
    whisperUsage: ReturnType<WhisperService['getUsageStats']>;
  }> {
    const stats = await this.db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN v.transcript_source = 'captions' THEN 1 ELSE 0 END) as captions,
        SUM(CASE WHEN v.transcript_source = 'whisper' THEN 1 ELSE 0 END) as whisper,
        AVG(t.quality_score) as avg_quality
      FROM transcripts t
      JOIN videos v ON t.video_id = v.id
    `);

    const row = stats[0] || {};
    
    return {
      totalTranscripts: row.total || 0,
      captionsCount: row.captions || 0,
      whisperCount: row.whisper || 0,
      averageQuality: row.avg_quality || 0,
      whisperUsage: this.whisperService.getUsageStats(),
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.whisperService.cleanup();
    await this.db.close();
  }
}
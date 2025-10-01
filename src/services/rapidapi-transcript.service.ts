import { WhisperTranscript, WhisperSegment } from './whisper.service.js';

export interface RapidAPIConfig {
  apiKey: string;
  host: string;
  rateLimit: number; // requests per second
}

interface RapidAPIResponse {
  success?: boolean;
  transcript?: Array<{
    text: string;
    start: number;
    duration: number;
  }>;
  language?: string;
  video_id?: string;
  error?: string;
  message?: string;
}

export class RapidAPITranscriptService {
  private config: RapidAPIConfig;
  private lastRequestTime: number = 0;
  private requestCount: number = 0;

  constructor(config: RapidAPIConfig) {
    this.config = config;
  }

  /**
   * Fetch transcript from RapidAPI YouTube Transcript service
   */
  async fetchTranscript(videoId: string, videoTitle: string = ''): Promise<WhisperTranscript | null> {
    try {
      console.log(`🔄 RapidAPI: Fetching transcript for ${videoTitle || videoId}`);
      
      await this.throttleRequests();
      
      const response = await this.makeAPIRequest(videoId);
      
      if (!response.transcript || response.transcript.length === 0) {
        throw new Error(response.error || response.message || 'No transcript data received');
      }

      const transcript = this.parseAPIResponse(response, videoId);
      console.log(`✅ RapidAPI: Successfully fetched transcript (${transcript.segments?.length || 0} segments)`);
      
      return transcript;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ RapidAPI transcript failed for ${videoId}: ${errorMessage}`);
      
      // Check if it's a rate limit error
      if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
        console.log(`⏳ Rate limited, waiting before retry...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Try once more after rate limit wait
        try {
          const retryResponse = await this.makeAPIRequest(videoId);
          if (retryResponse.transcript && retryResponse.transcript.length > 0) {
            return this.parseAPIResponse(retryResponse, videoId);
          }
        } catch (retryError) {
          console.warn(`❌ RapidAPI retry also failed for ${videoId}`);
        }
      }
      
      return null;
    }
  }

  /**
   * Make HTTP request to RapidAPI
   */
  private async makeAPIRequest(videoId: string): Promise<RapidAPIResponse> {
    const url = `https://${this.config.host}/api/transcript?videoId=${videoId}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': this.config.apiKey,
        'X-RapidAPI-Host': this.config.host,
      }
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Parse RapidAPI response to our WhisperTranscript format
   */
  private parseAPIResponse(response: RapidAPIResponse, videoId: string): WhisperTranscript {
    const transcriptArray = response.transcript || [];
    
    // Convert to our segment format
    const segments: WhisperSegment[] = transcriptArray.map((item, index) => ({
      id: index,
      start: item.start || 0,
      end: (item.start || 0) + (item.duration || 0),
      text: item.text || ''
    }));

    // Combine all text
    const fullText = segments.map(seg => seg.text).join(' ');

    // Calculate total duration
    const totalDuration = segments.length > 0 
      ? segments[segments.length - 1].end 
      : 0;

    return {
      text: fullText,
      segments,
      language: response.language || 'unknown',
      duration: totalDuration,
      source: 'youtube-auto', // RapidAPI typically returns auto-generated transcripts
      qualityScore: this.calculateQualityScore(fullText, segments.length, totalDuration)
    };
  }

  /**
   * Calculate quality score for RapidAPI transcripts
   */
  private calculateQualityScore(text: string, segmentCount: number, duration: number): number {
    // Base score for RapidAPI transcripts (generally reliable)
    let score = 0.75;

    // Length indicators
    const wordCount = text.split(' ').filter(word => word.length > 0).length;
    
    // Reasonable word density (words per minute)
    const wordsPerMinute = duration > 0 ? (wordCount / (duration / 60)) : 0;
    if (wordsPerMinute >= 100 && wordsPerMinute <= 200) {
      score += 0.1; // Good speaking pace
    }

    // Segment density (more segments usually means better timing)
    const segmentsPerMinute = duration > 0 ? (segmentCount / (duration / 60)) : 0;
    if (segmentsPerMinute >= 10 && segmentsPerMinute <= 40) {
      score += 0.05; // Good segmentation
    }

    // Text quality indicators
    if (wordCount > 50) {
      score += 0.05; // Sufficient content
    }

    // Penalty for lots of music/sound markers
    const soundMarkers = (text.match(/\[.*?\]|\(.*?\)/g) || []).length;
    const soundMarkerRatio = wordCount > 0 ? soundMarkers / wordCount : 0;
    if (soundMarkerRatio > 0.1) {
      score -= 0.1; // Too many non-speech markers
    }

    // Penalty for very repetitive content
    const uniqueWords = new Set(text.toLowerCase().split(' '));
    const uniqueRatio = wordCount > 0 ? uniqueWords.size / wordCount : 1;
    if (uniqueRatio < 0.3) {
      score -= 0.15; // Very repetitive
    }

    return Math.max(0.1, Math.min(1.0, score));
  }

  /**
   * Rate limiting to avoid hitting API limits
   */
  private async throttleRequests(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minInterval = 1000 / this.config.rateLimit; // milliseconds between requests
    
    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  /**
   * Get usage statistics
   */
  getUsageStats(): { requestCount: number; rateLimit: number } {
    return {
      requestCount: this.requestCount,
      rateLimit: this.config.rateLimit
    };
  }

  /**
   * Reset usage counter
   */
  resetUsage(): void {
    this.requestCount = 0;
    console.log('🔄 RapidAPI usage counter reset');
  }
}
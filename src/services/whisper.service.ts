import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import YTDlpWrap from 'yt-dlp-wrap';

export interface WhisperTranscript {
  text: string;
  segments?: WhisperSegment[];
  language: string;
  duration: number;
  source: 'whisper';
}

export interface WhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export class WhisperService {
  private openai: OpenAI;
  private maxFileSizeMB: number = 25; // OpenAI limit
  private maxDurationMinutes: number;
  private tempDir: string;
  private totalMinutesUsed: number = 0;

  constructor(apiKey: string, maxDurationMinutes: number = 180) {
    this.openai = new OpenAI({ apiKey });
    this.maxDurationMinutes = maxDurationMinutes;
    this.tempDir = path.join(process.cwd(), 'temp');
    
    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Transcribe a YouTube video using Whisper API
   */
  async transcribeVideo(videoId: string, videoTitle: string = '', videoDuration: number = 0): Promise<WhisperTranscript | null> {
    // Check if we've exceeded duration limit
    if (this.totalMinutesUsed >= this.maxDurationMinutes) {
      console.warn(`⚠ Whisper quota exceeded (${this.totalMinutesUsed}/${this.maxDurationMinutes} minutes)`);
      return null;
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const audioPath = path.join(this.tempDir, `${videoId}.m4a`);
    
    try {
      console.log(`🎧 Downloading audio for: ${videoTitle || videoId}`);
      
      // Download audio from YouTube
      await this.downloadAudio(videoUrl, audioPath);
      
      // Check file size and handle accordingly
      const stats = fs.statSync(audioPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      let transcript: WhisperTranscript;
      
      if (fileSizeMB <= this.maxFileSizeMB) {
        console.log(`🔄 Transcribing with Whisper (${fileSizeMB.toFixed(1)}MB)...`);
        transcript = await this.transcribeAudioFile(audioPath, videoDuration);
      } else {
        console.log(`⚠ File too large: ${fileSizeMB.toFixed(1)}MB > ${this.maxFileSizeMB}MB`);
        console.log(`🔪 Splitting audio into chunks for transcription...`);
        transcript = await this.transcribeAudioInChunks(audioPath, videoDuration);
      }
      
      // Update usage tracking
      const durationMinutes = videoDuration / 60;
      this.totalMinutesUsed += durationMinutes;
      
      console.log(`✅ Transcription complete (${durationMinutes.toFixed(1)} min)`);
      console.log(`📊 Whisper usage: ${this.totalMinutesUsed.toFixed(1)}/${this.maxDurationMinutes} minutes`);
      
      // Clean up temp file
      fs.unlinkSync(audioPath);
      
      return transcript;

    } catch (error) {
      console.error(`❌ Transcription failed for ${videoId}:`, error);
      
      // Clean up on error
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }
      
      return null;
    }
  }

  /**
   * Download audio from YouTube video using yt-dlp
   */
  private async downloadAudio(videoUrl: string, outputPath: string): Promise<void> {
    try {
      const ytDlpWrap = new YTDlpWrap();
      
      // Download optimized audio for transcription (small size, good quality for speech)
      await ytDlpWrap.execPromise([
        videoUrl,
        '--extract-audio',
        '--audio-format', 'm4a',
        '--audio-quality', '64K', // 64 kbps is sufficient for speech transcription
        '--postprocessor-args', '-ac 1 -ar 16000', // Mono, 16kHz (Whisper's internal rate)
        '--output', outputPath.replace('.m4a', '.%(ext)s'), // yt-dlp will add .m4a extension
        '--no-playlist',
        '--quiet', // Suppress output except errors
      ]);

      // yt-dlp might output with different filename, check for the actual file
      const baseOutput = outputPath.replace('.m4a', '');
      const actualPath = `${baseOutput}.m4a`;
      
      if (!fs.existsSync(actualPath)) {
        throw new Error(`Downloaded file not found at ${actualPath}`);
      }

      // If outputPath is different from actualPath, rename it
      if (actualPath !== outputPath) {
        fs.renameSync(actualPath, outputPath);
      }

    } catch (error) {
      console.error('yt-dlp download error:', error);
      throw new Error(`Failed to download audio: ${error}`);
    }
  }

  /**
   * Transcribe audio file with OpenAI Whisper
   */
  private async transcribeAudioFile(audioPath: string, videoDuration: number): Promise<WhisperTranscript> {
    const audioFile = fs.createReadStream(audioPath);
    
    try {
      // Use Whisper with timestamp information
      const response = await this.openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      });

      // Map OpenAI response to our interface
      const transcript: WhisperTranscript = {
        text: response.text,
        language: response.language || 'unknown',
        duration: videoDuration,
        source: 'whisper',
        segments: response.segments?.map((seg, index) => ({
          id: index,
          start: seg.start,
          end: seg.end,
          text: seg.text,
        })),
      };

      return transcript;

    } catch (error) {
      console.error('OpenAI Whisper API error:', error);
      throw error;
    }
  }

  /**
   * Transcribe large audio file by splitting into chunks
   */
  private async transcribeAudioInChunks(audioPath: string, videoDuration: number): Promise<WhisperTranscript> {
    const chunkDuration = 600; // 10 minutes per chunk
    const overlapSeconds = 30; // 30 second overlap to prevent context loss
    const chunks = Math.ceil(videoDuration / chunkDuration);
    
    console.log(`📊 Splitting into ${chunks} chunks (${chunkDuration/60}min each, ${overlapSeconds}s overlap)`);
    
    const allSegments: WhisperSegment[] = [];
    let fullText = '';
    let detectedLanguage = 'unknown';
    
    try {
      for (let i = 0; i < chunks; i++) {
        const startTime = Math.max(0, i * chunkDuration - (i > 0 ? overlapSeconds : 0));
        const endTime = Math.min(videoDuration, (i + 1) * chunkDuration);
        const chunkPath = audioPath.replace('.m4a', `_chunk${i}.m4a`);
        
        console.log(`🔪 Processing chunk ${i + 1}/${chunks} (${startTime}s-${endTime}s)`);
        
        // Split audio using ffmpeg
        await this.splitAudio(audioPath, chunkPath, startTime, endTime - startTime);
        
        // Transcribe chunk
        const chunkTranscript = await this.transcribeAudioFile(chunkPath, endTime - startTime);
        
        // Adjust timestamps and merge segments
        if (chunkTranscript.segments) {
          const adjustedSegments = chunkTranscript.segments.map(seg => ({
            ...seg,
            id: allSegments.length + seg.id,
            start: seg.start + startTime,
            end: seg.end + startTime,
          }));
          
          // Remove overlapping segments from previous chunk
          if (i > 0) {
            // Find segments that are in the overlap region and might be duplicates
            const overlapStart = startTime;
            const filteredSegments = adjustedSegments.filter(seg => 
              seg.start >= overlapStart + overlapSeconds / 2
            );
            allSegments.push(...filteredSegments);
          } else {
            allSegments.push(...adjustedSegments);
          }
        }
        
        fullText += ' ' + chunkTranscript.text.trim();
        detectedLanguage = chunkTranscript.language || detectedLanguage;
        
        // Clean up chunk file
        fs.unlinkSync(chunkPath);
      }
      
      const transcript: WhisperTranscript = {
        text: fullText.trim(),
        language: detectedLanguage,
        duration: videoDuration,
        source: 'whisper',
        segments: allSegments,
      };
      
      console.log(`✅ Completed chunked transcription: ${allSegments.length} segments`);
      return transcript;
      
    } catch (error) {
      console.error('Error in chunked transcription:', error);
      // Clean up any remaining chunk files
      for (let i = 0; i < chunks; i++) {
        const chunkPath = audioPath.replace('.m4a', `_chunk${i}.m4a`);
        if (fs.existsSync(chunkPath)) {
          fs.unlinkSync(chunkPath);
        }
      }
      throw error;
    }
  }

  /**
   * Split audio file using ffmpeg
   */
  private async splitAudio(inputPath: string, outputPath: string, startSeconds: number, durationSeconds: number): Promise<void> {
    
    try {
      const command = `ffmpeg -i "${inputPath}" -ss ${startSeconds} -t ${durationSeconds} -c copy "${outputPath}" -y -loglevel error`;
      execSync(command);
      
      // Verify output file exists
      if (!fs.existsSync(outputPath)) {
        throw new Error(`Failed to create split audio file: ${outputPath}`);
      }
      
    } catch (error) {
      throw new Error(`Audio splitting failed: ${error}`);
    }
  }

  /**
   * Get current usage statistics
   */
  getUsageStats(): { minutesUsed: number; minutesRemaining: number; percentageUsed: number } {
    return {
      minutesUsed: this.totalMinutesUsed,
      minutesRemaining: this.maxDurationMinutes - this.totalMinutesUsed,
      percentageUsed: (this.totalMinutesUsed / this.maxDurationMinutes) * 100,
    };
  }

  /**
   * Reset usage counter (for daily reset)
   */
  resetUsage(): void {
    this.totalMinutesUsed = 0;
    console.log('🔄 Whisper usage counter reset');
  }

  /**
   * Check if we can transcribe more content
   */
  canTranscribe(durationMinutes: number): boolean {
    return (this.totalMinutesUsed + durationMinutes) <= this.maxDurationMinutes;
  }

  /**
   * Estimate cost for transcription
   */
  estimateCost(durationMinutes: number): number {
    // OpenAI Whisper pricing: $0.006 per minute
    return durationMinutes * 0.006;
  }

  /**
   * Clean up temp directory
   */
  cleanup(): void {
    if (fs.existsSync(this.tempDir)) {
      const files = fs.readdirSync(this.tempDir);
      files.forEach(file => {
        const filePath = path.join(this.tempDir, file);
        try {
          fs.unlinkSync(filePath);
        } catch (error) {
          console.warn(`Could not delete temp file: ${filePath}`);
        }
      });
    }
  }
}
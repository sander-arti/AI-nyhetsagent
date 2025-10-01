import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import YTDlpWrap from 'yt-dlp-wrap';
// @ts-ignore - youtube-transcript has inconsistent types
const youtubeTranscript = require('youtube-transcript');

export interface WhisperTranscript {
  text: string;
  segments?: WhisperSegment[];
  language: string;
  duration: number;
  source: 'whisper' | 'youtube-auto' | 'youtube-manual';
  qualityScore?: number;
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
   * Transcribe a YouTube video using three-tier fallback system:
   * 1. Whisper API (preferred)
   * 2. Python youtube-transcript-api (fallback for bot detection)
   * 3. Node.js youtube-transcript (final fallback)
   */
  async transcribeVideo(videoId: string, videoTitle: string = '', videoDuration: number = 0): Promise<WhisperTranscript | null> {
    // Check if we've exceeded duration limit
    if (this.totalMinutesUsed >= this.maxDurationMinutes) {
      console.warn(`⚠ Whisper quota exceeded (${this.totalMinutesUsed}/${this.maxDurationMinutes} minutes)`);
      return null;
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const audioPath = path.join(this.tempDir, `${videoId}.m4a`);
    
    // TIER 1: Try Whisper API (preferred)
    try {
      console.log(`🎧 Tier 1: Attempting Whisper transcription for: ${videoTitle || videoId}`);
      
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
      
      console.log(`✅ Whisper transcription complete (${durationMinutes.toFixed(1)} min)`);
      console.log(`📊 Whisper usage: ${this.totalMinutesUsed.toFixed(1)}/${this.maxDurationMinutes} minutes`);
      
      // Clean up temp file
      fs.unlinkSync(audioPath);
      
      return transcript;

    } catch (error) {
      console.warn(`⚠ Tier 1 failed for ${videoId}: ${error.message}`);
      
      // Clean up on error
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }
      
      // Check if error indicates bot detection
      const errorMsg = error.message.toLowerCase();
      const isBotDetection = errorMsg.includes('bot') || 
                           errorMsg.includes('sign in') || 
                           errorMsg.includes('confirm') ||
                           errorMsg.includes('blocked');
      
      if (isBotDetection) {
        console.log(`🤖 Bot detection detected, trying fallback methods...`);
      }
    }

    // TIER 2: Try Python youtube-transcript-api
    try {
      console.log(`🐍 Tier 2: Attempting Python transcript fetch for: ${videoId}`);
      const pythonTranscript = await this.fetchTranscriptPython(videoId);
      if (pythonTranscript) {
        console.log(`✅ Python transcript fetch successful (${pythonTranscript.source})`);
        return pythonTranscript;
      }
    } catch (error) {
      console.warn(`⚠ Tier 2 failed for ${videoId}: ${error.message}`);
    }

    // TIER 3: Try Node.js youtube-transcript
    try {
      console.log(`📦 Tier 3: Attempting Node.js transcript fetch for: ${videoId}`);
      const nodeTranscript = await this.fetchTranscriptNode(videoId, videoDuration);
      if (nodeTranscript) {
        console.log(`✅ Node.js transcript fetch successful`);
        return nodeTranscript;
      }
    } catch (error) {
      console.warn(`⚠ Tier 3 failed for ${videoId}: ${error.message}`);
    }

    console.error(`❌ All transcription methods failed for ${videoId}`);
    return null;
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
   * TIER 2: Fetch transcript using Python youtube-transcript-api
   */
  private async fetchTranscriptPython(videoId: string): Promise<WhisperTranscript | null> {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(process.cwd(), 'scripts', 'fetch-transcript.py');
      const pythonProcess = spawn('python3', [scriptPath, videoId, '--languages', 'no', 'en', 'da', 'sv'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          try {
            const result = JSON.parse(stdout);
            if (result.success) {
              const transcript: WhisperTranscript = {
                text: result.text,
                segments: result.segments,
                language: result.language,
                duration: result.duration,
                source: result.source as 'youtube-auto' | 'youtube-manual',
                qualityScore: this.calculateYouTubeQualityScore(result.text, result.is_generated)
              };
              resolve(transcript);
            } else {
              reject(new Error(result.message || 'Python transcript fetch failed'));
            }
          } catch (parseError) {
            const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
            reject(new Error(`Failed to parse Python response: ${errorMsg}. Raw output: ${stdout.substring(0, 200)}...`));
          }
        } else {
          reject(new Error(`Python process failed (code ${code}). Stderr: ${stderr || 'No stderr'}. Stdout: ${stdout || 'No stdout'}`));
        }
      });

      pythonProcess.on('error', (error) => {
        reject(new Error(`Python process error: ${error.message}`));
      });
    });
  }

  /**
   * TIER 3: Fetch transcript using Node.js youtube-transcript package
   */
  private async fetchTranscriptNode(videoId: string, videoDuration: number): Promise<WhisperTranscript | null> {
    try {
      // Use the correct YoutubeTranscript API
      const transcript = await youtubeTranscript.YoutubeTranscript.fetchTranscript(videoId);
      
      if (!transcript || transcript.length === 0) {
        throw new Error('No transcript returned');
      }

      // Convert to our format
      const segments = transcript.map((item: any, index: number) => ({
        id: index,
        start: item.offset / 1000, // Convert ms to seconds
        end: (item.offset + item.duration) / 1000,
        text: item.text
      }));

      const fullText = transcript.map((item: any) => item.text).join(' ');
      
      // Estimate duration from last segment if not provided
      const estimatedDuration = videoDuration || 
        (transcript.length > 0 ? (transcript[transcript.length - 1].offset + transcript[transcript.length - 1].duration) / 1000 : 0);

      return {
        text: fullText,
        segments,
        language: 'unknown', // Node.js package doesn't provide language info
        duration: estimatedDuration,
        source: 'youtube-auto', // Assume auto-generated
        qualityScore: this.calculateYouTubeQualityScore(fullText, true)
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Node.js transcript fetch failed: ${errorMessage}`);
    }
  }

  /**
   * Calculate quality score for YouTube transcripts
   */
  private calculateYouTubeQualityScore(text: string, isGenerated: boolean): number {
    // Base score depends on whether it's manual or auto-generated
    let qualityScore = isGenerated ? 0.6 : 0.8;
    
    const wordCount = text.split(' ').length;
    
    // Bonus for reasonable length
    if (wordCount > 50) {
      qualityScore += 0.1;
    }
    
    // Penalty for lots of repetition or garbled text
    const uniqueWords = new Set(text.toLowerCase().split(' '));
    const uniqueRatio = uniqueWords.size / wordCount;
    if (uniqueRatio < 0.3) {
      qualityScore -= 0.2; // Very repetitive
    }
    
    // Penalty for lots of brackets (music, applause, etc.)
    const bracketsCount = (text.match(/\[.*?\]/g) || []).length;
    const bracketsRatio = bracketsCount / wordCount;
    if (bracketsRatio > 0.1) {
      qualityScore -= 0.15;
    }
    
    return Math.max(0.1, Math.min(1.0, qualityScore));
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
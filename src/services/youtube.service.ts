import { google } from 'googleapis';
import { YouTubeVideo, YouTubeChannel, VideoMetadata } from '../types/youtube.types.js';

export class YouTubeService {
  private youtube;
  private apiKey: string;
  private quotaUsed: number = 0;
  private maxQuota: number = 10000; // Daily quota limit

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.youtube = google.youtube({
      version: 'v3',
      auth: apiKey,
    });
  }

  /**
   * Extract channel ID from various YouTube URL formats
   */
  getChannelIdFromUrl(channelUrl: string): string {
    // Handle different YouTube URL formats:
    // https://www.youtube.com/@handle
    // https://www.youtube.com/c/customname  
    // https://www.youtube.com/channel/UC...
    // https://www.youtube.com/user/username

    const url = new URL(channelUrl);
    const pathname = url.pathname;

    // Direct channel ID format
    if (pathname.startsWith('/channel/')) {
      return pathname.split('/channel/')[1];
    }

    // For @handle, /c/, and /user/ we need to resolve via API
    // Return the identifier to be resolved later
    if (pathname.startsWith('/@')) {
      return pathname.substring(2); // Remove /@
    } 
    
    if (pathname.startsWith('/c/') || pathname.startsWith('/user/')) {
      return pathname.split('/')[2];
    }

    throw new Error(`Unsupported YouTube URL format: ${channelUrl}`);
  }

  /**
   * Resolve channel handle/username to actual channel ID
   */
  async resolveChannelId(identifier: string): Promise<string> {
    try {
      this.quotaUsed += 1; // channels.list costs 1 unit

      let response;
      
      if (identifier.startsWith('@')) {
        // Handle format: @username
        response = await this.youtube.channels.list({
          part: ['id'],
          forHandle: identifier,
        });
      } else if (identifier.startsWith('UC')) {
        // Direct channel ID
        response = await this.youtube.channels.list({
          part: ['id'], 
          id: [identifier],
        });
      } else {
        // Username format - try both forHandle and forUsername
        try {
          response = await this.youtube.channels.list({
            part: ['id'],
            forHandle: `@${identifier}`,
          });
        } catch (error) {
          response = await this.youtube.channels.list({
            part: ['id'],
            forUsername: identifier,
          });
        }
      }

      if (!response.data.items || response.data.items.length === 0) {
        throw new Error(`Channel not found: ${identifier}`);
      }

      return response.data.items[0].id!;
    } catch (error) {
      console.error(`Error resolving channel ID for ${identifier}:`, error);
      throw error;
    }
  }

  /**
   * Get channel uploads playlist ID
   */
  async getChannelUploadsPlaylistId(channelId: string): Promise<string> {
    try {
      this.quotaUsed += 1; // channels.list costs 1 unit

      const response = await this.youtube.channels.list({
        part: ['contentDetails'],
        id: [channelId],
      });

      if (!response.data.items || response.data.items.length === 0) {
        throw new Error(`Channel not found: ${channelId}`);
      }

      const uploadsPlaylistId = response.data.items[0].contentDetails?.relatedPlaylists?.uploads;
      
      if (!uploadsPlaylistId) {
        throw new Error(`Uploads playlist not found for channel: ${channelId}`);
      }

      return uploadsPlaylistId;
    } catch (error) {
      console.error(`Error getting uploads playlist for ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * Get new videos from playlist since a given date
   */
  async getNewVideosSince(playlistId: string, sinceDate: Date): Promise<string[]> {
    const videoIds: string[] = [];
    let pageToken: string | undefined = undefined;
    const maxResults = 50; // Max per request

    try {
      do {
        this.quotaUsed += 1; // playlistItems.list costs 1 unit

        const response = await this.youtube.playlistItems.list({
          part: ['snippet'],
          playlistId: playlistId,
          maxResults: maxResults,
          pageToken: pageToken,
          order: 'date', // Most recent first
        });

        if (!response.data.items) break;

        for (const item of response.data.items) {
          const publishedAt = new Date(item.snippet?.publishedAt || '');
          
          if (publishedAt <= sinceDate) {
            // Videos are ordered by date, so we can stop here
            return videoIds;
          }

          if (item.snippet?.resourceId?.videoId) {
            videoIds.push(item.snippet.resourceId.videoId);
          }
        }

        pageToken = response.data.nextPageToken || undefined;

      } while (pageToken && videoIds.length < 100); // Safety limit

      return videoIds;

    } catch (error) {
      console.error(`Error getting new videos from playlist ${playlistId}:`, error);
      throw error;
    }
  }

  /**
   * Get detailed metadata for multiple videos
   */
  async getVideoMetadata(videoIds: string[]): Promise<VideoMetadata[]> {
    if (videoIds.length === 0) return [];

    const videos: VideoMetadata[] = [];
    const batchSize = 50; // Max 50 IDs per request

    try {
      // Process in batches of 50
      for (let i = 0; i < videoIds.length; i += batchSize) {
        const batchIds = videoIds.slice(i, i + batchSize);
        this.quotaUsed += 1; // videos.list costs 1 unit per request

        const response = await this.youtube.videos.list({
          part: ['snippet', 'contentDetails'],
          id: batchIds,
        });

        if (!response.data.items) continue;

        for (const item of response.data.items) {
          if (!item.id || !item.snippet) continue;

          const durationSeconds = this.parseDuration(item.contentDetails?.duration || '');
          
          // Filtrer bort Shorts (≤60 sekunder)
          if (durationSeconds <= 60) {
            console.log(`⏭️ Skipping Short: "${item.snippet.title}" (${durationSeconds}s)`);
            continue;
          }
          
          // Filtrer bort live streams og premierer
          const liveBroadcastContent = item.snippet.liveBroadcastContent || 'none';
          if (liveBroadcastContent !== 'none') {
            console.log(`⏭️ Skipping live/premiere: "${item.snippet.title}"`);
            continue;
          }
          
          videos.push({
            id: item.id,
            title: item.snippet.title || '',
            publishedAt: new Date(item.snippet.publishedAt || ''),
            duration: durationSeconds,
            channelId: item.snippet.channelId || '',
            url: `https://www.youtube.com/watch?v=${item.id}`,
            hasCaptions: false, // We'll check this separately
          });
        }
      }

      return videos;

    } catch (error) {
      console.error('Error getting video metadata:', error);
      throw error;
    }
  }

  /**
   * Get recent videos from a channel (main method used by orchestrator)
   */
  async getChannelVideos(channelId: string, maxResults = 10): Promise<VideoMetadata[]> {
    try {
      // First get the uploads playlist ID
      const uploadsPlaylistId = await this.getChannelUploadsPlaylistId(channelId);
      
      // Get video IDs from the playlist
      const videoIds = await this.getRecentVideoIds(uploadsPlaylistId, maxResults);
      
      if (videoIds.length === 0) {
        return [];
      }
      
      // Get detailed metadata for the videos
      const videos = await this.getVideoMetadata(videoIds);
      
      return videos;

    } catch (error) {
      console.error(`Error getting channel videos for ${channelId}:`, error);
      return []; // Return empty array instead of throwing to allow pipeline to continue
    }
  }

  /**
   * Get recent video IDs from uploads playlist
   */
  private async getRecentVideoIds(playlistId: string, maxResults = 10): Promise<string[]> {
    try {
      this.quotaUsed += 1; // playlistItems.list costs 1 unit

      const response = await this.youtube.playlistItems.list({
        part: ['contentDetails'],
        playlistId,
        maxResults,
        order: 'date'
      });

      const videoIds: string[] = [];
      
      if (response.data.items) {
        for (const item of response.data.items) {
          const videoId = item.contentDetails?.videoId;
          if (videoId) {
            videoIds.push(videoId);
          }
        }
      }

      return videoIds;

    } catch (error) {
      console.error(`Error getting video IDs from playlist ${playlistId}:`, error);
      return [];
    }
  }

  /**
   * Check if video has captions available
   */
  async checkCaptions(videoId: string): Promise<boolean> {
    try {
      this.quotaUsed += 1; // captions.list costs 1 unit

      const response = await this.youtube.captions.list({
        part: ['id'],
        videoId: videoId,
      });

      return (response.data.items?.length || 0) > 0;

    } catch (error) {
      // If captions API fails, assume no captions
      console.warn(`Could not check captions for video ${videoId}:`, error);
      return false;
    }
  }

  /**
   * Parse ISO 8601 duration (PT4M13S) to seconds
   */
  private parseDuration(isoDuration: string): number {
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0'); 
    const seconds = parseInt(match[3] || '0');

    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Get current quota usage
   */
  getQuotaUsage(): { used: number; remaining: number; percentage: number } {
    return {
      used: this.quotaUsed,
      remaining: this.maxQuota - this.quotaUsed,
      percentage: (this.quotaUsed / this.maxQuota) * 100,
    };
  }

  /**
   * Add delay for rate limiting
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
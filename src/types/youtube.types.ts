// YouTube API types and interfaces

export interface YouTubeVideo {
  id: string;
  title: string;
  publishedAt: string;
  duration: string; // ISO 8601 format (e.g., "PT4M13S")
  durationSeconds: number;
  channelId: string;
  channelTitle: string;
  url: string;
  hasCaptions: boolean;
  language?: string;
}

export interface YouTubeChannel {
  id: string;
  title: string;
  handle?: string;
  uploadsPlaylistId: string;
}

export interface YouTubeCaption {
  videoId: string;
  text: string;
  segments: YouTubeCaptionSegment[];
  language: string;
  source: 'auto' | 'manual';
}

export interface YouTubeCaptionSegment {
  start: number; // seconds
  duration: number; // seconds
  text: string;
}

export interface YouTubeAPIConfig {
  apiKey: string;
  maxResults: number;
  quotaLimit: number; // Daily quota limit
}

export interface VideoMetadata {
  id: string;
  title: string;
  publishedAt: Date;
  duration: number; // seconds
  channelId: string;
  url: string;
  hasCaptions: boolean;
}

// Rate limiting
export interface RateLimitInfo {
  remainingQuota: number;
  resetTime: Date;
  requestsToday: number;
}
import { NewsItem, DebateItem, DevItem, ParsedItem } from './schemas.js';

export interface TopicCluster {
  mainEntity: string;              // "Sora 2", "Claude 4.5", "OpenAI"
  entityType: 'product' | 'company' | 'person' | 'concept';
  itemCount: number;
  subTopics: SubTopic[];
  relevanceScore: number;          // Høyeste score fra items
  sources: SourceAttribution[];
  confidence: 'high' | 'medium' | 'low';
}

export interface SubTopic {
  category: 'launch' | 'features' | 'technical' | 'ethical' | 'business' | 'comparison' | 'criticism' | 'other';
  items: ClusteredItem[];
  summary?: string;                // Valgfri overordnet sammendrag
  itemCount: number;
}

export interface ClusteredItem {
  originalItem: ParsedItem;
  uniqueAspects: string[];        // Hva som er unikt for dette item
  sourceDetails: {
    channel: string;
    confidence: 'high' | 'medium' | 'low';
    videoUrl: string;
    timestamp?: string;
    videotitle?: string;
  };
  clusterRelevance: number;       // Hvor relevant er dette for cluster
}

export interface SourceAttribution {
  channelName: string;
  videoUrl: string;
  itemCount: number;
  confidenceLevels: ('high' | 'medium' | 'low')[];
  avgRelevanceScore: number;
}

export interface ClusteredBrief {
  clusters: TopicCluster[];
  standaloneItems: ParsedItem[];
  stats: ClusteringStats;
  tldr: TLDRPoint[];
  generatedAt: Date;
}

export interface ClusteringStats {
  totalItems: number;
  clusteredItems: number;
  standaloneItems: number;
  totalClusters: number;
  largestClusterSize: number;
  averageClusterSize: number;
  processingTimeMs: number;
}

export interface TLDRPoint {
  summary: string;
  sourceCount: number;
  relevanceScore: number;
  mainEntity?: string;
  category: 'breaking' | 'major' | 'notable';
}

export interface EntityExtraction {
  entity: string;
  frequency: number;
  contexts: string[];             // Hvor entity ble funnet
  type: 'product' | 'company' | 'person' | 'concept';
  confidence: number;             // 0-1 hvor sikre vi er på type
}

export interface ClusteringConfig {
  enabled: boolean;
  minClusterSize: number;
  entityExtractionThreshold: number;
  preserveAllDetails: boolean;
  generateSummaries: boolean;
  tldrConfig: {
    enabled: boolean;
    maxPoints: number;
    includeStats: boolean;
  };
}

// Helper type for clustering process
export interface ClusterCandidate {
  entity: string;
  relatedItems: ParsedItem[];
  score: number;
  type: EntityExtraction['type'];
}
import { ChunkInfo } from '../services/llm.service.js';

/**
 * Chunking configuration options
 */
export interface ChunkingOptions {
  maxTokens: number;              // Maximum tokens per chunk (6000 for news, 3500 for others)
  minTokens: number;               // Minimum tokens per chunk (1000)
  similarityThreshold: number;     // Cosine similarity threshold for topic boundaries (0.7)
  overlapStrategy: 'fixed' | 'semantic' | 'adaptive';
  preferCompleteness: boolean;     // Prefer complete topics over strict token limits
}

/**
 * Enhanced chunk with semantic information
 */
export interface SemanticChunk extends ChunkInfo {
  topicId: string;
  boundaryType: 'hard' | 'soft' | 'none';
  semanticCoherence: number;       // 0-1, avg similarity within chunk
  estimatedCompleteness: number;   // 0-1, how complete is this topic
  relatedChunks: string[];         // IDs of semantically related chunks
  qualityScore: number;            // 0-1, overall quality
}

/**
 * Topic boundary detection result
 */
export interface TopicBoundary {
  segmentIndex: number;
  similarityScore: number;         // Cosine similarity at this boundary
  boundaryStrength: 'hard' | 'soft';
  confidence: number;              // 0-1, confidence in this being a boundary
  detectionMethod: 'embedding' | 'keyword' | 'temporal' | 'combined';
}

/**
 * Segment group for building chunks
 */
export interface SegmentGroup {
  segments: any[];                 // TranscriptSegment[]
  startIndex: number;
  endIndex?: number;
  tokenCount: number;
  topicId?: string;
}

/**
 * Chunk quality score breakdown
 */
export interface ChunkQualityScore {
  overall: number;                 // 0-1
  semanticCoherence: number;       // Avg similarity within chunk
  topicCompleteness: number;       // How complete is the topic
  sizeOptimality: number;          // How close to ideal size
  boundaryClarity: number;         // How clear are the boundaries
  warnings: string[];
}

/**
 * Chunking comparison metrics
 */
export interface ChunkingComparison {
  oldMethod: {
    chunks: number;
    avgSize: number;
    itemsExtracted: number;
  };
  newMethod: {
    chunks: number;
    avgSize: number;
    avgQuality: number;
    itemsExtracted: number;
    topicsDetected: number;
  };
  improvement: {
    chunksReduced: number;
    qualityIncrease: number;
    itemsIncreasePercent: number;
  };
}

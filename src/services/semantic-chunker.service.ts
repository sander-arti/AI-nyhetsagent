import { EmbeddingService, SegmentEmbedding, TranscriptSegment } from './embedding.service.js';
import { ProcessedTranscript } from '../processors/transcript.processor.js';
import {
  ChunkingOptions,
  SemanticChunk,
  TopicBoundary,
  SegmentGroup,
  ChunkQualityScore
} from '../types/chunking.types.js';

export class SemanticChunkerService {
  private embeddingService: EmbeddingService;

  constructor(openaiApiKey: string) {
    this.embeddingService = new EmbeddingService(openaiApiKey);
  }

  /**
   * Main method: Create semantic chunks from transcript
   */
  async createSemanticChunks(
    transcript: ProcessedTranscript,
    options: ChunkingOptions
  ): Promise<SemanticChunk[]> {
    const startTime = Date.now();

    console.log(`🧠 Creating semantic chunks with options:`, {
      maxTokens: options.maxTokens,
      minTokens: options.minTokens,
      threshold: options.similarityThreshold,
      strategy: options.overlapStrategy
    });

    // Step 1: Detect topic boundaries
    const boundaries = await this.detectTopicBoundaries(
      transcript.segments,
      options.similarityThreshold
    );

    console.log(`📍 Detected ${boundaries.length} topic boundaries`);

    // Step 2: Build chunks from boundaries
    const chunks = this.buildChunksFromBoundaries(
      transcript.segments,
      boundaries,
      options
    );

    console.log(`📦 Created ${chunks.length} semantic chunks`);

    // Step 3: Validate quality
    const validatedChunks = chunks.map(chunk => {
      const quality = this.validateChunkQuality(chunk);
      return {
        ...chunk,
        qualityScore: quality.overall
      };
    });

    const processingTime = Date.now() - startTime;
    const avgQuality = validatedChunks.reduce((sum, c) => sum + c.qualityScore, 0) / validatedChunks.length;

    console.log(`✅ Semantic chunking completed in ${processingTime}ms`);
    console.log(`📊 Average quality score: ${(avgQuality * 100).toFixed(1)}%`);

    return validatedChunks;
  }

  /**
   * Detect topic boundaries using multi-layer approach
   */
  private async detectTopicBoundaries(
    segments: TranscriptSegment[],
    similarityThreshold: number
  ): Promise<TopicBoundary[]> {
    if (segments.length < 2) {
      return [];
    }

    console.log(`🔍 Detecting topic boundaries in ${segments.length} segments...`);

    // Layer 1: Embedding-based detection
    const embeddingBoundaries = await this.detectEmbeddingBoundaries(
      segments,
      similarityThreshold
    );

    // Layer 2: Keyword-based detection
    const keywordBoundaries = this.detectKeywordBoundaries(segments);

    // Layer 3: Temporal/silence detection
    const temporalBoundaries = this.detectTemporalBoundaries(segments);

    // Combine all boundaries
    const combined = this.combineBoundaries([
      embeddingBoundaries,
      keywordBoundaries,
      temporalBoundaries
    ]);

    return combined.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Layer 1: Embedding-based boundary detection
   */
  private async detectEmbeddingBoundaries(
    segments: TranscriptSegment[],
    threshold: number
  ): Promise<TopicBoundary[]> {
    // Generate embeddings for all segments
    const embeddings = await this.embeddingService.generateSegmentEmbeddings(segments);

    const boundaries: TopicBoundary[] = [];

    // Calculate similarity between consecutive segments
    for (let i = 1; i < embeddings.length; i++) {
      const similarity = this.embeddingService.cosineSimilarity(
        embeddings[i - 1].embedding,
        embeddings[i].embedding
      );

      // Low similarity = topic shift
      if (similarity < threshold) {
        boundaries.push({
          segmentIndex: i,
          similarityScore: similarity,
          boundaryStrength: similarity < 0.5 ? 'hard' : 'soft',
          confidence: 1 - similarity,  // Lower similarity = higher confidence
          detectionMethod: 'embedding'
        });
      }
    }

    console.log(`  🧮 Embedding detection: ${boundaries.length} boundaries`);
    return boundaries;
  }

  /**
   * Layer 2: Keyword-based boundary detection
   */
  private detectKeywordBoundaries(segments: TranscriptSegment[]): TopicBoundary[] {
    const transitionKeywords = [
      'now', 'next', 'moving on', 'let\'s talk about', 'speaking of',
      'on another note', 'switching gears', 'meanwhile', 'however',
      'but', 'anyway', 'alright', 'first up', 'also', 'in addition',
      'turning to', 'looking at', 'shifting to'
    ];

    const boundaries: TopicBoundary[] = [];

    for (let i = 1; i < segments.length; i++) {
      const text = segments[i].text.toLowerCase();

      // Check for transition keywords at start of segment
      const hasTransition = transitionKeywords.some(keyword =>
        text.startsWith(keyword) || text.includes(` ${keyword} `)
      );

      if (hasTransition) {
        boundaries.push({
          segmentIndex: i,
          similarityScore: 0,  // N/A for keyword detection
          boundaryStrength: 'soft',
          confidence: 0.6,  // Medium confidence
          detectionMethod: 'keyword'
        });
      }
    }

    console.log(`  🔑 Keyword detection: ${boundaries.length} boundaries`);
    return boundaries;
  }

  /**
   * Layer 3: Temporal/silence boundary detection
   */
  private detectTemporalBoundaries(segments: TranscriptSegment[]): TopicBoundary[] {
    const boundaries: TopicBoundary[] = [];
    const silenceThreshold = 3; // 3+ seconds = potential topic shift

    for (let i = 1; i < segments.length; i++) {
      const gap = segments[i].start - segments[i - 1].end;

      if (gap >= silenceThreshold) {
        boundaries.push({
          segmentIndex: i,
          similarityScore: 0,  // N/A
          boundaryStrength: gap >= 5 ? 'hard' : 'soft',
          confidence: Math.min(gap / 10, 0.8),  // Longer silence = higher confidence
          detectionMethod: 'temporal'
        });
      }
    }

    console.log(`  ⏱️ Temporal detection: ${boundaries.length} boundaries`);
    return boundaries;
  }

  /**
   * Combine boundaries from multiple detection methods
   */
  private combineBoundaries(boundaryGroups: TopicBoundary[][]): TopicBoundary[] {
    const boundaryMap = new Map<number, TopicBoundary[]>();

    // Group boundaries by segment index
    for (const group of boundaryGroups) {
      for (const boundary of group) {
        if (!boundaryMap.has(boundary.segmentIndex)) {
          boundaryMap.set(boundary.segmentIndex, []);
        }
        boundaryMap.get(boundary.segmentIndex)!.push(boundary);
      }
    }

    // Merge boundaries at same index
    const merged: TopicBoundary[] = [];

    for (const [index, boundaries] of boundaryMap.entries()) {
      if (boundaries.length === 1) {
        merged.push(boundaries[0]);
      } else {
        // Multiple detection methods agree - boost confidence
        const avgConfidence = boundaries.reduce((sum, b) => sum + b.confidence, 0) / boundaries.length;
        const boostedConfidence = Math.min(avgConfidence * 1.3, 1.0);  // 30% boost

        const strongestBoundary = boundaries.reduce((best, current) =>
          current.confidence > best.confidence ? current : best
        );

        merged.push({
          segmentIndex: index,
          similarityScore: strongestBoundary.similarityScore,
          boundaryStrength: boundaries.some(b => b.boundaryStrength === 'hard') ? 'hard' : 'soft',
          confidence: boostedConfidence,
          detectionMethod: 'combined'
        });
      }
    }

    return merged;
  }

  /**
   * Build chunks from detected boundaries
   */
  private buildChunksFromBoundaries(
    segments: TranscriptSegment[],
    boundaries: TopicBoundary[],
    options: ChunkingOptions
  ): SemanticChunk[] {
    const chunks: SemanticChunk[] = [];
    let currentGroup: SegmentGroup = {
      segments: [],
      startIndex: 0,
      tokenCount: 0
    };

    let chunkIdCounter = 0;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const boundary = boundaries.find(b => b.segmentIndex === i);

      currentGroup.segments.push(segment);
      currentGroup.tokenCount += this.estimateTokens(segment.text);

      // Decision: Should we chunk here?
      const shouldChunk = this.shouldCreateChunk(currentGroup, boundary, options);

      if (shouldChunk) {
        // Finalize current chunk
        const chunk = this.finalizeChunk(
          currentGroup,
          chunkIdCounter++,
          boundary
        );
        chunks.push(chunk);

        // Start new chunk with overlap
        currentGroup = this.createNewChunkWithOverlap(
          currentGroup,
          boundary,
          options
        );
        currentGroup.startIndex = i;
      }
    }

    // Add final chunk
    if (currentGroup.segments.length > 0) {
      chunks.push(this.finalizeChunk(currentGroup, chunkIdCounter++, undefined));
    }

    return chunks;
  }

  /**
   * Decide whether to create a chunk at this point
   */
  private shouldCreateChunk(
    group: SegmentGroup,
    boundary: TopicBoundary | undefined,
    options: ChunkingOptions
  ): boolean {
    // Don't chunk if below minimum
    if (group.tokenCount < options.minTokens) {
      return false;
    }

    // Always chunk at hard boundaries (if above minimum)
    if (boundary && boundary.boundaryStrength === 'hard') {
      return true;
    }

    // Chunk if exceeded maximum
    if (group.tokenCount >= options.maxTokens) {
      return true;
    }

    // Chunk at soft boundary if we're at 60% of max
    if (boundary && boundary.boundaryStrength === 'soft') {
      const utilizationRatio = group.tokenCount / options.maxTokens;
      return utilizationRatio >= 0.6;
    }

    // Don't chunk
    return false;
  }

  /**
   * Finalize a chunk
   */
  private finalizeChunk(
    group: SegmentGroup,
    chunkId: number,
    boundary: TopicBoundary | undefined
  ): SemanticChunk {
    const text = group.segments.map(s => s.text).join(' ');
    const startTime = group.segments[0].start;
    const endTime = group.segments[group.segments.length - 1].end;

    return {
      text,
      startTime,
      endTime,
      wordCount: text.split(' ').length,
      hasTopicShift: boundary !== undefined,
      topicId: `topic_${chunkId}`,
      boundaryType: boundary ? boundary.boundaryStrength : 'none',
      semanticCoherence: 0,  // Will be calculated in validation
      estimatedCompleteness: boundary?.boundaryStrength === 'hard' ? 1.0 : 0.7,
      relatedChunks: [],
      qualityScore: 0  // Will be calculated in validation
    };
  }

  /**
   * Create new chunk with intelligent overlap
   */
  private createNewChunkWithOverlap(
    previousGroup: SegmentGroup,
    boundary: TopicBoundary | undefined,
    options: ChunkingOptions
  ): SegmentGroup {
    if (options.overlapStrategy === 'semantic') {
      // Include last complete sentence/topic
      const overlapSegments = this.findSemanticOverlap(previousGroup);
      return {
        segments: overlapSegments,
        startIndex: previousGroup.startIndex + previousGroup.segments.length - overlapSegments.length,
        tokenCount: overlapSegments.reduce((sum, s) => sum + this.estimateTokens(s.text), 0)
      };
    }

    if (options.overlapStrategy === 'adaptive') {
      // More overlap for hard boundaries
      const overlapRatio = boundary?.boundaryStrength === 'hard' ? 0.2 : 0.1;
      const overlapCount = Math.max(1, Math.floor(previousGroup.segments.length * overlapRatio));
      const overlapSegments = previousGroup.segments.slice(-overlapCount);

      return {
        segments: overlapSegments,
        startIndex: previousGroup.startIndex + previousGroup.segments.length - overlapCount,
        tokenCount: overlapSegments.reduce((sum, s) => sum + this.estimateTokens(s.text), 0)
      };
    }

    // Fixed overlap (default)
    const overlapCount = Math.max(1, Math.floor(previousGroup.segments.length * 0.1));
    const overlapSegments = previousGroup.segments.slice(-overlapCount);

    return {
      segments: overlapSegments,
      startIndex: previousGroup.startIndex + previousGroup.segments.length - overlapCount,
      tokenCount: overlapSegments.reduce((sum, s) => sum + this.estimateTokens(s.text), 0)
    };
  }

  /**
   * Find semantic overlap (last complete thought)
   */
  private findSemanticOverlap(group: SegmentGroup): any[] {
    // Find last sentence boundary (., !, ?)
    for (let i = group.segments.length - 1; i >= Math.max(0, group.segments.length - 3); i--) {
      const text = group.segments[i].text;
      if (text.match(/[.!?]\s*$/)) {
        // Found sentence boundary, include from here
        return group.segments.slice(i);
      }
    }

    // Fallback: last 2 segments
    return group.segments.slice(-2);
  }

  /**
   * Validate chunk quality
   */
  private validateChunkQuality(chunk: SemanticChunk): ChunkQualityScore {
    const scores = {
      semanticCoherence: 0.8,  // Placeholder - would need embeddings to calculate properly
      topicCompleteness: chunk.estimatedCompleteness,
      sizeOptimality: this.calculateSizeOptimality(chunk.wordCount),
      boundaryClarity: chunk.boundaryType === 'hard' ? 1.0 :
                       chunk.boundaryType === 'soft' ? 0.7 : 0.4
    };

    const warnings: string[] = [];

    if (scores.sizeOptimality < 0.5) {
      warnings.push('Chunk size is not optimal');
    }

    if (scores.topicCompleteness < 0.6) {
      warnings.push('Topic may be incomplete');
    }

    if (chunk.boundaryType === 'none') {
      warnings.push('No clear boundary detected');
    }

    const overall = Object.values(scores).reduce((sum, score) => sum + score, 0) / Object.keys(scores).length;

    // Update chunk with coherence score
    chunk.semanticCoherence = scores.semanticCoherence;

    return {
      overall,
      ...scores,
      warnings
    };
  }

  /**
   * Calculate size optimality (0-1)
   */
  private calculateSizeOptimality(wordCount: number): number {
    // Ideal: 70% of max tokens (rough estimate: 1 token ≈ 0.75 words)
    const idealWords = 6000 * 0.7 * 0.75;  // ~3150 words for news
    const diff = Math.abs(wordCount - idealWords);
    const diffRatio = diff / idealWords;

    return Math.max(0, 1 - diffRatio);
  }

  /**
   * Estimate tokens from text
   */
  private estimateTokens(text: string): number {
    // Rough estimation: 1 token ≈ 4 characters or 0.75 words
    return Math.ceil(text.split(' ').length * 1.3);
  }
}

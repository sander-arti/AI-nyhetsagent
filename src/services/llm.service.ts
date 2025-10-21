import OpenAI from 'openai';
import { ProcessedTranscript } from '../processors/transcript.processor.js';
import { VideoParsingResult } from '../types/schemas.js';
import { createResponseFormat } from '../utils/schema-converter.js';
import { OutputValidatorService, ItemValidationResult } from './output-validator.service.js';
import { SemanticChunkerService } from './semantic-chunker.service.js';
import { ChunkingOptions } from '../types/chunking.types.js';
import {
  MultiPassConfig,
  MultiPassResult,
  MultiPassMetrics,
  GapAnalysis,
  Pass1Result,
  Pass2Result,
  Pass3Result
} from '../types/multi-pass.types.js';
import { ConsensusService } from './consensus.service.js';
import { ConsensusConfig, ConsensusResult, ModelResult } from '../types/consensus.types.js';
import { DEFAULT_CONSENSUS_CONFIG } from '../config/consensus.config.js';
import { createModelProviders } from './model-providers/provider-factory.js';
import { BaseModelProvider, ModelProviderRequest } from './model-providers/base-provider.js';

export interface ChunkInfo {
  text: string;
  startTime: number;
  endTime: number;
  wordCount: number;
  hasTopicShift: boolean;
}

export interface ParseRequest {
  transcript: ProcessedTranscript;
  sourceType: 'news' | 'debate' | 'dev';
  videoMetadata: {
    title: string;
    channelName: string;
    channelId: string;
    sourceUrl: string;
    duration: number;
    publishedAt: Date;
  };
  maxTokens?: number;
}

export class LLMService {
  private openai: OpenAI;
  private maxTokensPerChunk: number = 3500; // Safe limit for GPT-4o-mini
  private overlapRatio: number = 0.1; // 10% overlap between chunks
  private totalTokensUsed: number = 0;
  private totalCost: number = 0;
  private validator: OutputValidatorService;
  private semanticChunker: SemanticChunkerService;
  private useSemanticChunking: boolean = true; // Feature flag

  // Multi-pass extraction configuration
  private useMultiPass: boolean = false; // Feature flag (disabled by default)
  private multiPassConfig: MultiPassConfig = {
    enablePass1: true,
    enablePass2: true,
    enablePass3: false, // Disabled by default - too aggressive
    minConfidenceForSkipPass2: 0.9,
    maxItemsBeforeRefinement: 20
  };

  // Multi-model consensus configuration
  private useConsensus: boolean = false; // Feature flag (disabled by default)
  private consensusConfig: ConsensusConfig = DEFAULT_CONSENSUS_CONFIG;
  private consensusService: ConsensusService;
  private modelProviders: Map<string, BaseModelProvider>;

  constructor(apiKey: string, apiKeys?: { anthropic?: string; google?: string }) {
    this.openai = new OpenAI({ apiKey });
    this.validator = new OutputValidatorService();
    this.semanticChunker = new SemanticChunkerService(apiKey);
    this.consensusService = new ConsensusService(this.consensusConfig);

    // Initialize model providers for consensus
    const allApiKeys = {
      openai: apiKey,
      anthropic: apiKeys?.anthropic || process.env.ANTHROPIC_API_KEY,
      google: apiKeys?.google || process.env.GOOGLE_API_KEY,
    };

    this.modelProviders = createModelProviders(
      [
        this.consensusConfig.hierarchical.tier1Model,
        this.consensusConfig.hierarchical.tier2Model,
        this.consensusConfig.hierarchical.tier3Model,
      ],
      allApiKeys
    );
  }

  /**
   * Enable/disable multi-pass extraction
   */
  public setMultiPass(enabled: boolean): void {
    this.useMultiPass = enabled;
  }

  /**
   * Configure multi-pass extraction settings
   */
  public setMultiPassConfig(config: Partial<MultiPassConfig>): void {
    this.multiPassConfig = {
      ...this.multiPassConfig,
      ...config
    };
  }

  /**
   * Enable/disable multi-model consensus
   */
  public setConsensus(enabled: boolean): void {
    this.useConsensus = enabled;
  }

  /**
   * Configure multi-model consensus settings
   */
  public setConsensusConfig(config: Partial<ConsensusConfig>): void {
    this.consensusConfig = {
      ...this.consensusConfig,
      ...config
    };
    this.consensusService = new ConsensusService(this.consensusConfig);
  }

  /**
   * Main parsing method - orchestrates the entire process
   */
  async parseTranscript(request: ParseRequest): Promise<VideoParsingResult> {
    const startTime = Date.now();
    
    try {
      console.log(`🧠 Parsing ${request.sourceType} video: ${request.videoMetadata.title}`);
      
      // 1. Smart chunking of transcript (now async with semantic chunking)
      const chunks = await this.intelligentChunking(request.transcript, request.sourceType);
      console.log(`📄 Split into ${chunks.length} intelligent chunks`);
      
      // 2. Process chunks in parallel with rate limiting
      const chunkResults = await this.processChunksWithRateLimit(chunks, request);

      // 3. Merge and deduplicate results
      const mergedResults = this.mergeChunkResults(chunkResults, request.sourceType);

      const processingTimeMs = Date.now() - startTime;

      // 4. Aggregate multi-pass metrics if enabled
      const multiPassMetrics = this.useMultiPass
        ? this.aggregateMultiPassMetrics(chunkResults)
        : undefined;

      // 5. Create final result
      const result: VideoParsingResult = {
        videoId: request.transcript.videoId,
        sourceType: request.sourceType,
        totalItems: mergedResults.length,
        processingTimeMs,
        tokensUsed: this.totalTokensUsed,
        estimatedCost: this.totalCost,
        multiPassMetrics,
        ...this.categorizeItems(mergedResults, request.sourceType)
      };

      console.log(`✅ Parsed ${result.totalItems} items in ${processingTimeMs}ms`);
      console.log(`💰 Cost: $${this.totalCost.toFixed(4)} (${this.totalTokensUsed} tokens)`);

      if (multiPassMetrics) {
        console.log(`📊 Multi-pass: P1=${multiPassMetrics.pass1Items} P2=+${multiPassMetrics.pass2Items} P3=${multiPassMetrics.pass3Improvements} improvements`);
      }

      return result;

    } catch (error) {
      console.error('❌ LLM parsing failed:', error);
      throw error;
    }
  }

  /**
   * Intelligent chunking that respects natural boundaries
   * NEW: Uses semantic chunking when available
   */
  private async intelligentChunking(transcript: ProcessedTranscript, sourceType?: string): Promise<ChunkInfo[]> {
    const segments = transcript.segments;

    // Adjust chunk size based on source type
    const maxTokensForType = sourceType === 'news' ? 6000 : this.maxTokensPerChunk;
    const overlapForType = sourceType === 'news' ? 0.2 : this.overlapRatio;

    // Use semantic chunking if enabled and segments available
    if (this.useSemanticChunking && segments && segments.length > 0) {
      try {
        console.log('🧠 Using semantic chunking...');

        const options: ChunkingOptions = {
          maxTokens: maxTokensForType,
          minTokens: 1000,
          similarityThreshold: 0.7,
          overlapStrategy: 'adaptive',
          preferCompleteness: true
        };

        const semanticChunks = await this.semanticChunker.createSemanticChunks(
          transcript,
          options
        );

        // Log quality metrics
        const avgQuality = semanticChunks.reduce((sum, c) => sum + c.qualityScore, 0) / semanticChunks.length;
        console.log(`📊 Semantic chunking: ${semanticChunks.length} chunks, avg quality: ${(avgQuality * 100).toFixed(1)}%`);

        return semanticChunks;
      } catch (error) {
        console.warn('⚠️ Semantic chunking failed, falling back to token-based:', error);
        // Fallback to old method
      }
    }

    // Fallback: Token-based chunking (old method)
    console.log('⚠️ Using token-based chunking (semantic disabled or failed)');

    if (segments.length === 0) {
      // Fallback: simple text chunking
      return this.simpleTextChunking(transcript.text, maxTokensForType);
    }

    const chunks: ChunkInfo[] = [];
    
    let currentChunk: ChunkInfo = {
      text: '',
      startTime: segments[0].start,
      endTime: segments[0].end,
      wordCount: 0,
      hasTopicShift: false
    };
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment || !segment.text || typeof segment.text !== 'string') {
        console.warn(`⚠️ Invalid segment at index ${i}:`, segment);
        continue;
      }
      const segmentWords = segment.text.split(' ').length;
      
      // Check if adding this segment would exceed token limit
      const potentialWordCount = currentChunk.wordCount + segmentWords;
      const estimatedTokens = potentialWordCount * 1.3; // Rough estimation
      
      if (estimatedTokens > maxTokensForType && currentChunk.wordCount > 0) {
        // Finalize current chunk
        chunks.push({ ...currentChunk });
        
        // Start new chunk with overlap
        const overlapStart = Math.max(0, i - Math.floor(segments.length * overlapForType));
        const overlapSegments = segments.slice(overlapStart, i + 1).filter(s => s && s.text && typeof s.text === 'string');
        currentChunk = {
          text: overlapSegments.map(s => s.text).join(' '),
          startTime: segments[overlapStart]?.start || 0,
          endTime: segment.end || 0,
          wordCount: overlapSegments.reduce((acc, s) => acc + s.text.split(' ').length, 0),
          hasTopicShift: this.detectTopicShift(segments[i - 1]?.text, segment.text)
        };
      } else {
        // Add segment to current chunk
        if (currentChunk.text) {
          currentChunk.text += ' ';
        }
        currentChunk.text += segment.text || '';
        currentChunk.endTime = segment.end;
        currentChunk.wordCount += segmentWords;
      }
    }
    
    // Add final chunk if not empty
    if (currentChunk.wordCount > 0) {
      chunks.push(currentChunk);
    }
    
    return chunks.length > 0 ? chunks : this.simpleTextChunking(transcript.text, maxTokensForType);
  }

  /**
   * Simple fallback chunking when segments are not available
   */
  private simpleTextChunking(text: string, maxTokens: number = this.maxTokensPerChunk): ChunkInfo[] {
    const words = text.split(' ');
    const chunks: ChunkInfo[] = [];
    const wordsPerChunk = Math.floor(maxTokens / 1.3);
    
    for (let i = 0; i < words.length; i += wordsPerChunk) {
      const chunkWords = words.slice(i, i + wordsPerChunk);
      chunks.push({
        text: chunkWords.join(' '),
        startTime: 0, // No timing info available
        endTime: 0,
        wordCount: chunkWords.length,
        hasTopicShift: false
      });
    }
    
    return chunks;
  }

  /**
   * Detect topic shifts between segments (simple heuristic)
   */
  private detectTopicShift(prevText?: string, currentText?: string): boolean {
    if (!prevText || !currentText) return false;
    
    // Simple heuristics for topic shifts
    const transitionWords = [
      'now', 'next', 'moving on', 'let\'s talk about', 'speaking of',
      'on another note', 'switching gears', 'meanwhile', 'however',
      'but', 'anyway', 'so', 'alright'
    ];
    
    const currentLower = currentText.toLowerCase();
    return transitionWords.some(word => currentLower.includes(word));
  }

  /**
   * Process chunks with rate limiting to avoid API limits
   */
  private async processChunksWithRateLimit(
    chunks: ChunkInfo[],
    request: ParseRequest
  ): Promise<any[]> {
    const results: any[] = [];
    const CONCURRENT_LIMIT = 3; // Process 3 chunks at a time
    const DELAY_MS = 1000; // 1 second delay between batches

    for (let i = 0; i < chunks.length; i += CONCURRENT_LIMIT) {
      const batch = chunks.slice(i, i + CONCURRENT_LIMIT);

      console.log(`🔄 Processing chunk batch ${Math.floor(i / CONCURRENT_LIMIT) + 1}/${Math.ceil(chunks.length / CONCURRENT_LIMIT)}`);

      const batchPromises = batch.map(chunk => {
        // Priority order: Multi-pass > Consensus > Single-pass
        if (this.useMultiPass) {
          return this.extractItemsMultiPass(chunk, request);
        } else if (this.useConsensus) {
          return this.processChunkWithConsensus(chunk, request);
        } else {
          return this.processChunk(chunk, request);
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Rate limiting delay
      if (i + CONCURRENT_LIMIT < chunks.length) {
        await this.delay(DELAY_MS);
      }
    }

    return results;
  }

  /**
   * Process a single chunk with LLM (with validation and retry)
   */
  private async processChunk(
    chunk: ChunkInfo,
    request: ParseRequest,
    retryAttempt: number = 0
  ): Promise<any> {
    const maxRetries = 2;
    const prompt = this.buildPrompt(chunk, request);

    try {
      // Use structured JSON schema output for guaranteed valid structure
      const responseFormat = createResponseFormat(request.sourceType);

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(request.sourceType)
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: responseFormat,
        temperature: retryAttempt > 0 ? 0.2 : 0.1, // Slightly higher temp on retry
        max_tokens: 2000, // Increased for detailed responses
      });

      const usage = completion.usage;
      if (usage) {
        this.totalTokensUsed += usage.total_tokens;
        // GPT-4o-mini pricing: $0.000150/1K input tokens, $0.000600/1K output tokens
        const inputCost = (usage.prompt_tokens / 1000) * 0.000150;
        const outputCost = (usage.completion_tokens / 1000) * 0.000600;
        this.totalCost += inputCost + outputCost;
      }

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        console.warn('⚠️ Empty response from LLM');
        return { items: [] };
      }

      const parsed = JSON.parse(content);

      // Validate extracted items
      if (parsed.items && Array.isArray(parsed.items) && parsed.items.length > 0) {
        // Add metadata fields to each item before validation
        const itemsWithMetadata = parsed.items.map((item: any) => ({
          ...item,
          videoId: request.transcript.videoId,
          channelId: request.videoMetadata.channelId,
          sourceUrl: request.videoMetadata.sourceUrl
        }));

        // Set validation mode based on retry attempt (adaptive thresholds)
        this.validator.setValidationMode(retryAttempt);

        const validationResults = await this.validator.validateExtractedItems(
          itemsWithMetadata,
          chunk,
          request.sourceType
        );

        // Check if we need to retry
        const needsRetry = validationResults.some(r => r.shouldRetry);
        const hasErrors = validationResults.some(r => r.validation.errors.length > 0);

        if ((needsRetry || hasErrors) && retryAttempt < maxRetries) {
          console.warn(`⚠️ Validation issues found, retrying (attempt ${retryAttempt + 1}/${maxRetries})`);

          // Build enhanced prompt with validation feedback
          const enhancedRequest = this.buildEnhancedRequest(
            request,
            chunk,
            validationResults
          );

          // Retry with enhanced prompt
          return await this.processChunk(chunk, enhancedRequest, retryAttempt + 1);
        }

        // Filter out items with critical errors
        const validItems = validationResults
          .filter(r => r.validation.isValid)
          .map(r => r.item);

        // Log validation stats
        const totalItems = validationResults.length;
        const validCount = validItems.length;
        const errorCount = validationResults.filter(r => !r.validation.isValid).length;
        const warningCount = validationResults.filter(r => r.validation.warnings.length > 0).length;

        if (errorCount > 0 || warningCount > 0) {
          console.log(`📊 Validation: ${validCount}/${totalItems} valid, ${errorCount} errors, ${warningCount} warnings`);
        }

        return { items: validItems };
      }

      return parsed;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Chunk processing failed:', errorMessage);

      // Don't retry on API errors
      return { items: [], error: errorMessage };
    }
  }

  /**
   * Process chunk with multi-model consensus
   */
  private async processChunkWithConsensus(
    chunk: ChunkInfo,
    request: ParseRequest
  ): Promise<any> {
    if (!this.useConsensus || this.modelProviders.size === 0) {
      // Fallback to single model
      return this.processChunk(chunk, request);
    }

    console.log(`🤝 Using ${this.consensusConfig.strategy} consensus validation`);

    const systemPrompt = this.getSystemPrompt(request.sourceType);
    const userPrompt = this.buildPrompt(chunk, request);
    const modelResults: ModelResult[] = [];

    // Hierarchical strategy
    if (this.consensusConfig.strategy === 'hierarchical' && this.consensusConfig.hierarchical.enabled) {
      // Tier 1: Fast model (GPT-4o-mini)
      const tier1ModelId = this.consensusConfig.hierarchical.tier1Model;
      const tier1Provider = this.modelProviders.get(tier1ModelId);

      if (tier1Provider) {
        const tier1Result = await this.callModelProvider(
          tier1Provider,
          { systemPrompt, userPrompt, temperature: 0.1, maxTokens: 2000, responseFormat: 'json' },
          chunk,
          request
        );
        modelResults.push(tier1Result);

        // Check if we need Tier 2
        const needsTier2 = tier1Result.confidence < this.consensusConfig.hierarchical.tier2Threshold;

        if (needsTier2) {
          const tier2ModelId = this.consensusConfig.hierarchical.tier2Model;
          const tier2Provider = this.modelProviders.get(tier2ModelId);

          if (tier2Provider) {
            const tier2Result = await this.callModelProvider(
              tier2Provider,
              { systemPrompt, userPrompt, temperature: 0.1, maxTokens: 2000, responseFormat: 'json' },
              chunk,
              request
            );
            modelResults.push(tier2Result);

            // Check for conflict
            const disagreement = Math.abs(tier2Result.confidence - tier1Result.confidence);
            if (disagreement > this.consensusConfig.hierarchical.conflictThreshold) {
              // Use Tier 3 arbiter
              const tier3ModelId = this.consensusConfig.hierarchical.tier3Model;
              const tier3Provider = this.modelProviders.get(tier3ModelId);

              if (tier3Provider) {
                const tier3Result = await this.callModelProvider(
                  tier3Provider,
                  { systemPrompt, userPrompt, temperature: 0.0, maxTokens: 2000, responseFormat: 'json' },
                  chunk,
                  request
                );
                modelResults.push(tier3Result);
              }
            }
          }
        }
      }
    } else if (this.consensusConfig.strategy === 'ensemble' && this.consensusConfig.ensemble.enabled) {
      // Ensemble: Query all models in parallel
      const modelIds = this.consensusConfig.ensemble.models;
      const modelPromises = modelIds.map(async (modelId) => {
        const provider = this.modelProviders.get(modelId);
        if (provider) {
          return this.callModelProvider(
            provider,
            { systemPrompt, userPrompt, temperature: 0.1, maxTokens: 2000, responseFormat: 'json' },
            chunk,
            request
          );
        }
        return null;
      });

      const results = await Promise.all(modelPromises);
      modelResults.push(...results.filter((r): r is ModelResult => r !== null));
    }

    // Use consensus service to validate results
    const consensusResult = await this.consensusService.validateWithConsensus(modelResults);

    // Update performance metrics
    for (const result of modelResults) {
      this.consensusService.updatePerformanceMetrics(result.modelId, result);
    }

    // Track total cost and tokens
    this.totalCost += consensusResult.metrics.totalCost;
    this.totalTokensUsed += modelResults.reduce((sum, r) => sum + r.tokenUsage.input + r.tokenUsage.output, 0);

    console.log(`🤝 Consensus: ${consensusResult.items.length} items, avg agreement: ${(consensusResult.metrics.averageAgreement * 100).toFixed(1)}%`);

    return {
      items: consensusResult.items,
      consensusMetrics: consensusResult.metrics,
      quality: consensusResult.quality,
    };
  }

  /**
   * Call a model provider and return structured result
   */
  private async callModelProvider(
    provider: BaseModelProvider,
    request: ModelProviderRequest,
    chunk: ChunkInfo,
    parseRequest: ParseRequest
  ): Promise<ModelResult> {
    const startTime = Date.now();

    try {
      const response = await provider.generateCompletion(request);
      const parsed = JSON.parse(response.content);

      // Validate items
      let validItems = parsed.items || [];
      if (validItems.length > 0) {
        const validationResults = await this.validator.validateExtractedItems(
          validItems,
          chunk,
          parseRequest.sourceType
        );
        validItems = validationResults.filter(r => r.validation.isValid).map(r => r.item);
      }

      // Calculate confidence
      const confidence = validItems.length > 0
        ? validItems.reduce((sum: number, item: any) => sum + (item.relevance / 10), 0) / validItems.length
        : 0;

      const cost = provider.calculateCost(response.usage.inputTokens, response.usage.outputTokens);
      const processingTimeMs = Date.now() - startTime;

      const { getModelConfig } = await import('../config/consensus.config.js');
      const modelConfig = getModelConfig(provider.getModelId());

      return {
        modelId: provider.getModelId(),
        provider: modelConfig?.provider || 'openai',
        tier: modelConfig?.tier || 1,
        items: validItems,
        confidence,
        cost,
        processingTimeMs,
        tokenUsage: {
          input: response.usage.inputTokens,
          output: response.usage.outputTokens,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Model ${provider.getModelId()} failed:`, errorMessage);

      const { getModelConfig } = await import('../config/consensus.config.js');
      const modelConfig = getModelConfig(provider.getModelId());

      return {
        modelId: provider.getModelId(),
        provider: modelConfig?.provider || 'openai',
        tier: modelConfig?.tier || 1,
        items: [],
        confidence: 0,
        cost: 0,
        processingTimeMs: Date.now() - startTime,
        tokenUsage: { input: 0, output: 0 },
        error: errorMessage,
      };
    }
  }

  /**
   * Build enhanced request with validation feedback for retry
   */
  private buildEnhancedRequest(
    originalRequest: ParseRequest,
    chunk: ChunkInfo,
    validationResults: ItemValidationResult[]
  ): ParseRequest {
    // Collect all validation issues
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    validationResults.forEach(result => {
      if (result.validation.errors.length > 0) {
        allErrors.push(...result.validation.errors);
      }
      if (result.validation.warnings.length > 0) {
        allWarnings.push(...result.validation.warnings);
      }
    });

    // Build feedback section
    const feedbackSection = `

⚠️ VALIDATION FEEDBACK FROM PREVIOUS ATTEMPT:

CRITICAL ERRORS (must fix):
${allErrors.length > 0 ? allErrors.map(e => `- ${e}`).join('\n') : '(none)'}

WARNINGS (improve quality):
${allWarnings.length > 0 ? allWarnings.map(w => `- ${w}`).join('\n') : '(none)'}

CORRECTIVE ACTIONS:
1. Double-check that ALL entities mentioned actually appear in rawContext
2. Ensure rawContext is an EXACT quote from the transcript (not paraphrased)
3. Verify that summary is directly supported by rawContext
4. Set confidence to 'low' if information is vague or implied
5. If uncertain about any detail, SKIP that item rather than guess

REMEMBER: Quality over quantity. It's better to extract fewer, accurate items than many questionable ones.
`;

    return {
      ...originalRequest,
      // Original prompt will be used, feedback is in system prompt
      _validationFeedback: feedbackSection
    } as any;
  }

  /**
   * Build prompt for chunk processing
   */
  private buildPrompt(chunk: ChunkInfo, request: ParseRequest): string {
    const metadata = request.videoMetadata;
    const timeInfo = chunk.startTime > 0 ?
      `\nTiming: ${this.formatTime(chunk.startTime)} - ${this.formatTime(chunk.endTime)}` : '';

    // Add validation feedback if this is a retry
    const validationFeedback = (request as any)._validationFeedback || '';

    return `Analyze this ${request.sourceType} content and extract relevant items.

Video: "${metadata.title}"
Channel: ${metadata.channelName}
Published: ${metadata.publishedAt.toDateString()}${timeInfo}

Content to analyze:
"""
${chunk.text}
"""

Extract all relevant ${request.sourceType === 'news' ? 'news items' :
                      request.sourceType === 'debate' ? 'debate topics' :
                      'developer-relevant items'} from this content.

Return a JSON object with an "items" array containing the structured data.
Each item should include a "rawContext" field with the original text excerpt.
Set confidence based on how clear and specific the information is.

IMPORTANT: Each item MUST include a "relevance_score" field (1-10 integer):
- 9-10: Breaking news, major releases (ChatGPT-4o, Claude 3.5 Sonnet)
- 7-8: Important updates, new tools (API changes, significant features)
- 5-6: Interesting developments (research results, case studies)
- 3-4: Minor updates, nice-to-know (small improvements, tips)
- 1-2: Trivia, speculation (rumors, opinions, old news)

Example: A new ChatGPT feature = 8, a research paper = 6, a minor bug fix = 3.${validationFeedback}`;
  }

  /**
   * Get system prompt based on source type
   */
  private getSystemPrompt(sourceType: 'news' | 'debate' | 'dev'): string {
    const base = `Du er en ekspert AI-analytiker som ekstraherer strukturert informasjon fra video-transkripsjoner.

🎯 CHAIN-OF-THOUGHT PROSESS (følg dette steg-for-steg):

Steg 1: LES TRANSKRIPSJONEN NØYE
- Les gjennom hele teksten én gang
- Identifiser hovedtemaer og nøkkelinformasjon
- Marker potensielle items i hodet ditt

Steg 2: FOR HVER POTENSIELL ITEM - VERIFISER
- Er informasjonen EKSPLISITT nevnt? (Ja/Nei)
- Kan jeg finne eksakt støtte i teksten? (Ja/Nei)
- Er det konkrete detaljer (navn, tall, datoer)? (Ja/Nei)
- Hvis NEI på noen av disse → HOPP OVER denne itemen

Steg 3: EKSTRAHER RAWCONTEXT ⚠️ KRITISK VIKTIG!
rawContext = CTRL+C / CTRL+V fra transkripsjonen - INGEN omformulering!

❌ FEIL (parafrasering):
Transcript: "OpenAI today announced the release of GPT-4 Turbo with vision capabilities"
rawContext: "OpenAI lanserte GPT-4 Turbo med bildeforståelse" ← NEI! Dette er omformulert!

✅ RIKTIG (eksakt kopi):
Transcript: "OpenAI today announced the release of GPT-4 Turbo with vision capabilities"
rawContext: "OpenAI today announced the release of GPT-4 Turbo with vision capabilities" ← JA! Eksakt kopi!

REGLER FOR RAWCONTEXT:
1. Kopier ORDRETT fra transkripsjonen (copy-paste mentalitet)
2. IKKE oversett til norsk
3. IKKE skriv om eller omformuler
4. IKKE oppsummer eller forkorte
5. rawContext skal være 50-300 tegn - finn relevant tekstbit som støtter itemen
6. Hvis du ikke kan finne eksakt match i teksten → HOPP OVER denne itemen

Steg 4: IDENTIFISER ENTITIES
- List opp ALLE selskaper/produkter/personer nevnt i rawContext
- Hvis en entity IKKE finnes i rawContext → FJERN DEN
- Hvis ingen entities → bruk tom array []

Steg 5: SELF-CRITIQUE
- Leser jeg noe mellom linjene? (hvis ja → senk confidence eller hopp over)
- Bruker jeg eksterne kunnskaper? (hvis ja → STOPP og hopp over)
- Er summary støttet 100% av rawContext? (hvis nei → revider eller hopp over)
- Er alle påkrevde felter fylt ut korrekt? (hvis nei → fiks det)

Steg 6: BESTEM CONFIDENCE
- HIGH: Eksplisitte facts, konkrete detaljer, klare utsagn
- MEDIUM: Informasjon er klar men mangler noen detaljer
- LOW: Informasjon er implisert eller vag
- HVIS I TVIL → velg lavere confidence

KRITISKE REGLER:
- Skriv ALT på norsk
- Ekstraher KUN informasjon som er eksplisitt nevnt i transkripsjonen
- IKKE legg til eksterne kunnskaper eller antakelser
- Vær KONKRET og SPESIFIKK - ikke vag eller generell
- Inkluder tall, navn, versjoner, datoer, benchmarks når nevnt
- Hver item må ha et "rawContext" felt med eksakt tekst-utdrag
- Returner gyldig JSON med en "items" array
- Bruk eksakte type-verdier: release, tool, policy, research, acquisition, funding, other

STRENGE FORMAT-KRAV:
- title: 10-150 tegn (vær beskrivende og konkret)
- summary: 50-200 tegn (MAKS 200 tegn - kort og presist)
- relevance_score: ALLTID PÅKREVD som heltall 1-10 (9-10: Breaking news, 7-8: Viktig, 5-6: Interessant, 3-4: Minor, 1-2: Trivia)
- rawContext: ALLTID PÅKREVD - eksakt tekstutdrag fra transkripsjonen
- confidence: ALLTID PÅKREVD - high/medium/low basert på klarhet
- Hold alle tekstfelt innenfor disse strenge grensene

🚫 HALLUCINATION PREVENTION:
ALDRI gjør dette:
❌ Legg til info som ikke er nevnt: "OpenAI lanserer GPT-5" når bare "new model" nevnes
❌ Fyll inn manglende detaljer: Hvis versjonsnummer ikke nevnes, IKKE gjett
❌ Ekstrapolér: Hvis "testing new features" nevnes, IKKE anta hva featurene er
❌ Bruk eksterne fakta: Selv om du vet GPT-4 finnes, nevn kun hvis det er i teksten

✅ Gjør dette isteden:
✓ Ekstraher kun eksplisitte facts
✓ Hvis vag info → sett confidence til 'low' eller hopp over
✓ Hvis mangler nøkkelinfo → hopp over helt
✓ Kvalitet over kvantitet - bedre 2 perfekte items enn 5 tvilsomme`;

    const specific = {
      news: `
FOKUS PÅ: Produktlanseringer, bedriftsannonseringer, policy-endringer, forskningsfunn, oppkjøp, finansiering
EKSTRAHER: title (10-150 tegn på norsk), summary (50-400 tegn med KONKRETE detaljer), entities (selskaper/produkter nevnt), type, påvirkningsnivå
Type må være en av: release, tool, policy, research, acquisition, funding, other
Entiteter må være faktiske selskap/produktnavn nevnt i teksten, eller tom array hvis ingen.
Summary må være DETALJERT og KONKRET - inkluder tall, navn, versjoner, funksjoner, datoer som nevnt i videoen. IKKE bruk vage ord som "forbedringer" eller "endringer".

SPESIELL HÅNDTERING AV SAMMENDRAGSVIDEOER:
- Hvis videoen inneholder mange korte nyhetsomtaler i listeformat, ekstraher hver nyhet som separat item
- For raske gjennomganger: Bruk tilgjengelig informasjon selv om den er kortfattet
- Godta kortere beskrivelser hvis det er det som er tilgjengelig i originalkilden
- Fang opp overskrifter som "First up...", "Next...", "Also this week..." som signaler på separate nyheter

Eksempel god summary: "OpenAI lanserer ChatGPT Canvas-modus med split-screen editor, versjonskontroll og inline-redigering. Rulles ut til Plus-brukere denne uken."

📚 FEW-SHOT EKSEMPLER PÅ PERFEKT RAWCONTEXT:

EKSEMPEL 1 - RIKTIG:
Transcript: "...and then Anthropic announced their new Claude 3.5 Sonnet model which they say has significantly improved coding capabilities and can now handle up to 200,000 tokens in context..."
Output:
{
  "title": "Anthropic lanserer Claude 3.5 Sonnet med forbedret koding",
  "summary": "Ny modell med betydelig bedre kodeferdigheter og støtte for 200,000 tokens kontekst.",
  "type": "release",
  "relevance_score": 9,
  "entities": ["Anthropic", "Claude 3.5 Sonnet"],
  "rawContext": "Anthropic announced their new Claude 3.5 Sonnet model which they say has significantly improved coding capabilities and can now handle up to 200,000 tokens in context",
  "confidence": "high"
}

EKSEMPEL 2 - FEIL (parafrasert rawContext):
❌ IKKE gjør dette:
{
  "rawContext": "Anthropic har lansert en ny AI-modell med bedre kodeferdigheter" ← FEIL! Omformulert!
}

EKSEMPEL 3 - RIKTIG (eksakt quote):
Transcript: "...so Google just dropped Gemini 2.0 Flash and it's absolutely insane, it's running at like twice the speed of the previous version and it costs half as much..."
Output:
{
  "title": "Google lanserer Gemini 2.0 Flash",
  "summary": "Dobbel hastighet sammenlignet med forrige versjon og halvparten av kostnaden.",
  "type": "release",
  "relevance_score": 8,
  "entities": ["Google", "Gemini 2.0 Flash"],
  "rawContext": "Google just dropped Gemini 2.0 Flash and it's absolutely insane, it's running at like twice the speed of the previous version and it costs half as much",
  "confidence": "high"
}

🎯 NØKKELPOENG: rawContext skal være COPY-PASTE fra transkripsjonen, IKKE din egen omskriving!`,

      debate: `
FOKUS PÅ: Diskusjonstemaer, forskjellige synspunkter, argumenter, konsekvenser
EKSTRAHER: topic (10-120 tegn på norsk), whatWasDiscussed (50-400 tegn med SPESIFIKK innhold), pro/contra posisjoner, nøkkelsitater med kontekst, implications (20-300 tegn)
Fang nyansene i forskjellige perspektiver og HVORFOR temaet betyr noe.
Vær KONKRET om hva som faktisk ble diskutert - ikke vag om "diverse synspunkter". Inkluder spesifikke argumenter, eksempler og sitater.

PÅKREVDE FELTER for debate-items:
1. positions: ALLTID inkluder objekt med {"pro": [], "contra": []} arrays. Hvis ingen argumenter nevnt, bruk tomme arrays.
2. keyQuotes: ALLTID inkluder array med sitater. Hvis ingen sitater, bruk tom array [].
3. Hvert sitat må ha: quote, timestamp (HH:MM:SS format), og eventuelt speaker og context.
4. implications: ALLTID inkluder hvorfor dette temaet betyr noe (10-300 tegn). Forklar konsekvenser og betydning.
5. rawContext: ALLTID inkluder eksakt tekst-utdrag fra transkripsjonen som støtter denne debatten
6. relevance_score: ALLTID inkluder som heltall 1-10

EKSEMPEL DEBATE OUTPUT:
{
  "topic": "AI-regulering vs innovasjonsfrihet",
  "whatWasDiscussed": "Diskusjon om hvorvidt strenge AI-reguleringer hemmer innovasjon eller er nødvendige for sikkerhet",
  "positions": {
    "pro": ["Sikkerhet krever regulering", "Beskytter mot misbruk"],
    "contra": ["Hemmer innovasjon", "Gjør Europa mindre konkurransedyktig"]
  },
  "implications": "Reguleringsbeslutninger vil påvirke Europas posisjon i global AI-konkurranse",
  "keyQuotes": [],
  "relevance_score": 7,
  "rawContext": "The discussion centered around whether strict AI regulation would hurt innovation...",
  "confidence": "high"
}`,

      dev: `
FOKUS PÅ: Verktøylanseringer, API-endringer, tutorials, kodeeksempler, utviklerressurser
EKSTRAHER: title (10-150 tegn på norsk), whatChanged (20-300 tegn med SPESIFIKKE detaljer), hvordan det påvirker utviklere, nødvendige handlinger, lenker/ressurser nevnt
Prioriter KONKRET informasjon utviklere kan bruke umiddelbart. 
Inkluder versjonnumre, nye metoder/funksjoner, breaking changes, installasjonsinstruksjoner, API-endepunkt hvis nevnt.
Eksempel: "GitHub Copilot får nye @workspace kommando som lar deg referere hele prosjektet. Tilgjengelig i VS Code 1.85+ via Copilot Chat panel."

PÅKREVDE FELTER for dev-items:
1. changeType: ALLTID spesifiser en av: release, breaking, feature, tutorial, tool, api, framework, library (IKKE bruk 'policy')
2. developerAction: ALLTID spesifiser en av: try, update, evaluate, migrate, test, learn
3. whatChanged: ALLTID inkluder spesifikke detaljer om hva som er nytt/endret (20-200 tegn)
4. links: ALLTID inkluder array med URL-er nevnt i videoen. Hvis ingen lenker nevnt, bruk tom array []
5. rawContext: ALLTID inkluder eksakt tekst-utdrag fra transkripsjonen
6. relevance_score: ALLTID inkluder som heltall 1-10

EKSEMPEL DEV OUTPUT:
{
  "title": "GitHub Copilot får @workspace kommando",
  "whatChanged": "Ny @workspace kommando lar deg referere hele prosjektet i Copilot Chat. Tilgjengelig i VS Code 1.85+",
  "changeType": "feature",
  "developerAction": "try",
  "links": [],
  "relevance_score": 6,
  "rawContext": "GitHub announced the new @workspace command for Copilot Chat that allows developers to reference their entire project...",
  "confidence": "high"
}`
    };

    return base + specific[sourceType];
  }

  /**
   * Merge results from multiple chunks
   */
  private mergeChunkResults(chunkResults: any[], _sourceType: string): any[] {
    const allItems: any[] = [];
    
    for (const result of chunkResults) {
      if (result.items && Array.isArray(result.items)) {
        allItems.push(...result.items);
      }
    }
    
    // Simple deduplication based on title similarity
    const dedupedItems = this.deduplicateItems(allItems);
    
    return dedupedItems;
  }

  /**
   * Simple deduplication for chunk-level duplicates
   */
  private deduplicateItems(items: any[]): any[] {
    const seen = new Set<string>();
    const deduped: any[] = [];
    
    for (const item of items) {
      const key = (item.title || item.topic || '').toLowerCase().trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    }
    
    return deduped;
  }

  /**
   * Categorize items by type for result structure
   */
  private categorizeItems(items: any[], sourceType: string) {
    switch (sourceType) {
      case 'news':
        return { newsItems: items };
      case 'debate':
        return { debateItems: items };
      case 'dev':
        return { devItems: items };
      default:
        return {};
    }
  }

  /**
   * Format seconds to HH:MM:SS
   */
  private formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
  }

  /**
   * Delay utility for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get usage statistics
   */
  getUsageStats(): { tokensUsed: number; estimatedCost: number } {
    return {
      tokensUsed: this.totalTokensUsed,
      estimatedCost: this.totalCost
    };
  }

  /**
   * Reset usage counters (for new parsing session)
   */
  resetUsage(): void {
    this.totalTokensUsed = 0;
    this.totalCost = 0;
  }

  // ============================================================================
  // MULTI-PASS EXTRACTION METHODS
  // ============================================================================

  /**
   * Multi-pass extraction strategy with 3 passes:
   * Pass 1: Broad extraction
   * Pass 2: Gap filling
   * Pass 3: Refinement
   */
  async extractItemsMultiPass(
    chunk: ChunkInfo,
    request: ParseRequest
  ): Promise<MultiPassResult> {
    const startTime = Date.now();
    let totalCost = 0;
    const skippedPasses: string[] = [];

    console.log('🔄 Multi-pass extraction started...');

    // Pass 1: Broad extraction (existing logic)
    console.log('  📋 Pass 1: Broad extraction');
    const pass1Result = await this.processChunkSinglePass(chunk, request);
    totalCost += pass1Result.cost || 0;

    // Pass 2: Gap filling (conditional)
    let pass2Items: any[] = [];
    let pass2Cost = 0;
    if (this.shouldRunPass2(pass1Result)) {
      console.log('  🔍 Pass 2: Gap analysis and targeted extraction');
      const gaps = await this.identifyGaps(pass1Result.items, chunk, request);
      const pass2Result = await this.targetedExtraction(chunk, gaps, request);
      pass2Items = pass2Result.items;
      pass2Cost = pass2Result.cost;
      totalCost += pass2Cost;
    } else {
      skippedPasses.push('pass2');
    }

    // Merge items from pass 1 and 2
    const allItems = [...pass1Result.items, ...pass2Items];

    // Pass 3: Refinement (conditional)
    let refinedItems = allItems;
    let pass3Improvements = 0;
    let pass3Cost = 0;
    if (this.shouldRunPass3(allItems)) {
      console.log('  ✨ Pass 3: Refinement and deduplication');
      const pass3Result = await this.refineItems(allItems, chunk, request);
      refinedItems = pass3Result.items;
      pass3Improvements = pass3Result.improvements;
      pass3Cost = pass3Result.cost;
      totalCost += pass3Cost;
    } else {
      skippedPasses.push('pass3');
    }

    const totalTime = Date.now() - startTime;

    console.log(`  ✅ Multi-pass complete: ${refinedItems.length} items (${totalTime}ms, $${totalCost.toFixed(4)})`);

    return {
      items: refinedItems,
      validItems: refinedItems.length,
      cost: totalCost,
      passMetrics: {
        pass1Items: pass1Result.items.length,
        pass2Items: pass2Items.length,
        pass3Improvements,
        totalCost,
        totalTime,
        skippedPasses
      }
    };
  }

  /**
   * Wrapper for existing processChunk - single pass extraction
   */
  private async processChunkSinglePass(
    chunk: ChunkInfo,
    request: ParseRequest
  ): Promise<Pass1Result> {
    const startTime = Date.now();
    const result = await this.processChunk(chunk, request, 0);

    return {
      items: result.items || [],
      validItems: result.items?.length || 0,
      cost: result.cost || 0,
      processingTimeMs: Date.now() - startTime
    };
  }

  /**
   * Decide if Pass 2 (gap filling) should run
   */
  private shouldRunPass2(pass1Result: Pass1Result): boolean {
    if (!this.multiPassConfig.enablePass2) {
      return false;
    }

    // Skip if no items found (likely nothing to find)
    if (pass1Result.items.length === 0) {
      console.log('  ⏭️ Skipping Pass 2: No items found in Pass 1');
      return false;
    }

    // Skip if all items have very high confidence
    const allHighConfidence = pass1Result.items.every((item: any) =>
      item.confidence === 'very_high'
    );
    if (allHighConfidence) {
      console.log('  ⏭️ Skipping Pass 2: All items have very high confidence');
      return false;
    }

    return true;
  }

  /**
   * Decide if Pass 3 (refinement) should run
   */
  private shouldRunPass3(allItems: any[]): boolean {
    if (!this.multiPassConfig.enablePass3) {
      return false;
    }

    // Skip if only 1 item (nothing to refine/merge)
    if (allItems.length <= 1) {
      console.log('  ⏭️ Skipping Pass 3: Only 1 item, no refinement needed');
      return false;
    }

    // Skip if too many items (expensive)
    if (allItems.length > this.multiPassConfig.maxItemsBeforeRefinement) {
      console.log('  ⏭️ Skipping Pass 3: Too many items for refinement');
      return false;
    }

    return true;
  }

  /**
   * PASS 2: Identify gaps in extraction coverage
   */
  private async identifyGaps(
    extractedItems: any[],
    chunk: ChunkInfo,
    request: ParseRequest
  ): Promise<GapAnalysis> {
    // 1. Find uncovered time ranges
    const usedRanges = extractedItems
      .filter(item => item.startTime && item.endTime)
      .map(item => ({
        start: item.startTime,
        end: item.endTime
      }));

    const uncoveredRanges = this.findUncoveredRanges(
      { start: chunk.startTime, end: chunk.endTime },
      usedRanges
    );

    // 2. Detect incomplete patterns
    const incompletePatterns = this.detectIncompletePatterns(extractedItems, chunk);

    // 3. Find uncovered entities
    const mentionedEntities = this.extractAllEntities(chunk.text);
    const coveredEntities = new Set(
      extractedItems.flatMap(item => item.entities || [])
    );
    const uncoveredEntities = mentionedEntities.filter(
      e => !coveredEntities.has(e)
    );

    const shouldRunPass2 =
      uncoveredRanges.length > 0 ||
      incompletePatterns.length > 0 ||
      uncoveredEntities.length > 0;

    console.log(`    📊 Gap analysis: ${uncoveredRanges.length} time gaps, ${uncoveredEntities.length} uncovered entities, ${incompletePatterns.length} patterns`);

    return {
      uncoveredRanges,
      incompletePatterns,
      uncoveredEntities,
      shouldRunPass2
    };
  }

  /**
   * Find time ranges not covered by extracted items
   */
  private findUncoveredRanges(
    totalRange: { start: number; end: number },
    usedRanges: Array<{ start: number; end: number }>
  ): Array<{ start: number; end: number; duration: number }> {
    if (usedRanges.length === 0) {
      return [];
    }

    const sorted = usedRanges.sort((a, b) => a.start - b.start);
    const gaps = [];

    let currentEnd = totalRange.start;
    for (const range of sorted) {
      if (range.start > currentEnd) {
        gaps.push({
          start: currentEnd,
          end: range.start,
          duration: range.start - currentEnd
        });
      }
      currentEnd = Math.max(currentEnd, range.end);
    }

    // Check final gap
    if (currentEnd < totalRange.end) {
      gaps.push({
        start: currentEnd,
        end: totalRange.end,
        duration: totalRange.end - currentEnd
      });
    }

    // Only return significant gaps (>30 seconds)
    return gaps.filter(g => g.duration > 30);
  }

  /**
   * Detect incomplete patterns in extracted items
   */
  private detectIncompletePatterns(items: any[], chunk: ChunkInfo): string[] {
    const patterns = [];

    // Pattern 1: Incomplete sentence in summary
    const hasIncompleteSentence = items.some(item =>
      item.summary && !item.summary.match(/[.!?]$/)
    );
    if (hasIncompleteSentence) {
      patterns.push('incomplete_summary');
    }

    // Pattern 2: Missing context (very short items)
    const hasTooShortItems = items.some(item =>
      item.summary && item.summary.split(' ').length < 10
    );
    if (hasTooShortItems) {
      patterns.push('insufficient_context');
    }

    // Pattern 3: Missing timestamps
    const missingTimestamps = items.some(item =>
      !item.startTime || !item.endTime
    );
    if (missingTimestamps) {
      patterns.push('missing_timestamps');
    }

    return patterns;
  }

  /**
   * Extract all potential entities from text
   */
  private extractAllEntities(text: string): string[] {
    const entities = new Set<string>();

    // Company names and proper nouns (capitalized words)
    const companyPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
    const matches = text.matchAll(companyPattern);

    for (const match of matches) {
      if (this.isLikelyEntity(match[1])) {
        entities.add(match[1]);
      }
    }

    return Array.from(entities);
  }

  /**
   * Filter out common words that aren't entities
   */
  private isLikelyEntity(word: string): boolean {
    const commonWords = new Set([
      'The', 'This', 'That', 'Today', 'Now', 'Here', 'There',
      'They', 'What', 'When', 'Where', 'Why', 'How', 'Which',
      'And', 'But', 'Or', 'So', 'Because', 'However', 'Therefore'
    ]);
    return !commonWords.has(word) && word.length > 2;
  }

  /**
   * PASS 2: Targeted extraction for identified gaps
   */
  private async targetedExtraction(
    chunk: ChunkInfo,
    gaps: GapAnalysis,
    request: ParseRequest
  ): Promise<Pass2Result> {
    if (!gaps.shouldRunPass2) {
      return { items: [], cost: 0 };
    }

    const focusedPrompt = this.buildGapFillingPrompt(chunk, gaps, request);

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: focusedPrompt.system
        },
        {
          role: 'user',
          content: focusedPrompt.user
        }
      ],
      response_format: createResponseFormat(request.sourceType),
      temperature: 0.3 // Lower temp for focused extraction
    });

    const result = JSON.parse(response.choices[0].message.content || '{"items":[]}');

    // Calculate cost
    const usage = response.usage;
    let cost = 0;
    if (usage) {
      this.totalTokensUsed += usage.total_tokens;
      const inputCost = (usage.prompt_tokens / 1000) * 0.000150;
      const outputCost = (usage.completion_tokens / 1000) * 0.000600;
      cost = inputCost + outputCost;
      this.totalCost += cost;
    }

    console.log(`    ✅ Found ${result.items.length} additional items`);

    return {
      items: result.items,
      cost
    };
  }

  /**
   * Build prompt for gap-filling pass
   */
  private buildGapFillingPrompt(
    chunk: ChunkInfo,
    gaps: GapAnalysis,
    request: ParseRequest
  ): { system: string; user: string } {
    let focusInstructions = 'Focus on the following areas that may have been missed in the first pass:\n\n';

    if (gaps.uncoveredRanges.length > 0) {
      focusInstructions += '📍 Time ranges not covered:\n';
      gaps.uncoveredRanges.forEach(range => {
        focusInstructions += `  - ${this.formatTime(range.start)} to ${this.formatTime(range.end)} (${range.duration}s)\n`;
      });
      focusInstructions += '\n';
    }

    if (gaps.uncoveredEntities.length > 0) {
      focusInstructions += '🏢 Entities mentioned but not covered:\n';
      focusInstructions += `  ${gaps.uncoveredEntities.slice(0, 10).join(', ')}\n\n`;
    }

    if (gaps.incompletePatterns.length > 0) {
      focusInstructions += '⚠️ Patterns to address:\n';
      gaps.incompletePatterns.forEach(pattern => {
        focusInstructions += `  - ${pattern}\n`;
      });
      focusInstructions += '\n';
    }

    const systemPrompt = `You are a precise AI ${request.sourceType} extraction system performing a SECOND PASS extraction.

The first pass already extracted some items, but analysis shows there may be additional items in specific areas.

${focusInstructions}

Extract ONLY new items from these focus areas. Do NOT re-extract items that were likely caught in the first pass.

Focus on finding items that were missed, especially in the uncovered time ranges and topics mentioned above.`;

    const userPrompt = this.buildPrompt(chunk, request);

    return {
      system: systemPrompt,
      user: userPrompt
    };
  }

  /**
   * PASS 3: Refine and improve extracted items
   */
  private async refineItems(
    allItems: any[],
    chunk: ChunkInfo,
    request: ParseRequest
  ): Promise<Pass3Result> {
    const refinementPrompt = this.buildRefinementPrompt(allItems, chunk, request);

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: refinementPrompt.system
        },
        {
          role: 'user',
          content: refinementPrompt.user
        }
      ],
      response_format: createResponseFormat(request.sourceType),
      temperature: 0.2 // Very low temp for refinement
    });

    const result = JSON.parse(response.choices[0].message.content || '{"items":[]}');

    // Calculate cost
    const usage = response.usage;
    let cost = 0;
    if (usage) {
      this.totalTokensUsed += usage.total_tokens;
      const inputCost = (usage.prompt_tokens / 1000) * 0.000150;
      const outputCost = (usage.completion_tokens / 1000) * 0.000600;
      cost = inputCost + outputCost;
      this.totalCost += cost;
    }

    // Ensure items array exists
    const refinedItems = result.items || [];

    // Count improvements
    const improvements = this.countImprovements(allItems, refinedItems);

    console.log(`    ✅ Refined to ${refinedItems.length} items (${improvements} improvements)`);

    return {
      items: refinedItems,
      cost,
      improvements
    };
  }

  /**
   * Build prompt for refinement pass
   */
  private buildRefinementPrompt(
    items: any[],
    chunk: ChunkInfo,
    request: ParseRequest
  ): { system: string; user: string } {
    const systemPrompt = `You are an AI quality control system performing REFINEMENT on extracted ${request.sourceType} items.

Your tasks:
1. **Merge duplicates**: ONLY merge items that are clearly about the EXACT SAME news/event (not just similar topics)
2. **Enhance summaries**: Make summaries more complete and clear without adding fabricated information
3. **Fix entities**: Ensure all relevant entities from the transcript are listed
4. **Improve confidence**: Adjust confidence based on how well-supported each item is
5. **Verify relevance**: Ensure relevance scores accurately reflect importance

IMPORTANT:
- Do NOT remove items unless they are clear duplicates of another item
- Do NOT add new items. Only refine existing ones.
- Do NOT fabricate information. Only use what's in the original transcript.
- Each distinct news story/topic should remain as a separate item
- PRESERVE all unique items - only merge true duplicates

Input items: ${items.length}
Expected output: Close to ${items.length} (only merge obvious duplicates)`;

    const itemsJson = JSON.stringify(items, null, 2);

    const contextPreview = chunk.text.length > 2000
      ? chunk.text.substring(0, 2000) + '...'
      : chunk.text;

    const userPrompt = `Refine these extracted items by merging duplicates, enhancing quality, and fixing any issues:

ITEMS TO REFINE:
${itemsJson}

ORIGINAL TRANSCRIPT CONTEXT:
${contextPreview}

Return refined items in the same schema. Merge any duplicates into single, high-quality items.`;

    return {
      system: systemPrompt,
      user: userPrompt
    };
  }

  /**
   * Count improvements made during refinement
   */
  private countImprovements(originalItems: any[], refinedItems: any[]): number {
    if (!Array.isArray(originalItems) || !Array.isArray(refinedItems)) {
      return 0;
    }

    let improvements = 0;

    // Count merged duplicates
    const mergedCount = Math.max(0, originalItems.length - refinedItems.length);
    improvements += mergedCount;

    // Count enhanced summaries (significantly longer = more detailed)
    refinedItems.forEach((refined, i) => {
      if (refined && i < originalItems.length) {
        const original = originalItems[i];
        if (original && refined.summary && original.summary) {
          if (refined.summary.length > original.summary.length * 1.15) {
            improvements++;
          }
        }
      }
    });

    // Count improved entities (more entities = better coverage)
    refinedItems.forEach((refined, i) => {
      if (refined && i < originalItems.length) {
        const original = originalItems[i];
        if (original && refined.entities && original.entities) {
          if (refined.entities.length > original.entities.length) {
            improvements++;
          }
        }
      }
    });

    return improvements;
  }

  /**
   * Aggregate multi-pass metrics from all chunk results
   */
  private aggregateMultiPassMetrics(chunkResults: any[]): MultiPassMetrics {
    const totalMetrics: MultiPassMetrics = {
      pass1Items: 0,
      pass2Items: 0,
      pass3Improvements: 0,
      totalCost: 0,
      totalTime: 0,
      skippedPasses: []
    };

    chunkResults.forEach(result => {
      if (result.passMetrics) {
        totalMetrics.pass1Items += result.passMetrics.pass1Items || 0;
        totalMetrics.pass2Items += result.passMetrics.pass2Items || 0;
        totalMetrics.pass3Improvements += result.passMetrics.pass3Improvements || 0;
        totalMetrics.totalCost += result.passMetrics.totalCost || 0;
        totalMetrics.totalTime += result.passMetrics.totalTime || 0;

        // Track which passes were skipped (if any chunk skipped them)
        if (result.passMetrics.skippedPasses) {
          result.passMetrics.skippedPasses.forEach((pass: string) => {
            if (!totalMetrics.skippedPasses.includes(pass)) {
              totalMetrics.skippedPasses.push(pass);
            }
          });
        }
      }
    });

    return totalMetrics;
  }
}
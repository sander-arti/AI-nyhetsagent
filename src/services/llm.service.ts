import OpenAI from 'openai';
import { ProcessedTranscript } from '../processors/transcript.processor.js';
import { VideoParsingResult } from '../types/schemas.js';

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

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Main parsing method - orchestrates the entire process
   */
  async parseTranscript(request: ParseRequest): Promise<VideoParsingResult> {
    const startTime = Date.now();
    
    try {
      console.log(`🧠 Parsing ${request.sourceType} video: ${request.videoMetadata.title}`);
      
      // 1. Smart chunking of transcript
      const chunks = this.intelligentChunking(request.transcript, request.sourceType);
      console.log(`📄 Split into ${chunks.length} intelligent chunks`);
      
      // 2. Process chunks in parallel with rate limiting
      const chunkResults = await this.processChunksWithRateLimit(chunks, request);
      
      // 3. Merge and deduplicate results
      const mergedResults = this.mergeChunkResults(chunkResults, request.sourceType);
      
      const processingTimeMs = Date.now() - startTime;
      
      // 4. Create final result
      const result: VideoParsingResult = {
        videoId: request.transcript.videoId,
        sourceType: request.sourceType,
        totalItems: mergedResults.length,
        processingTimeMs,
        tokensUsed: this.totalTokensUsed,
        estimatedCost: this.totalCost,
        ...this.categorizeItems(mergedResults, request.sourceType)
      };
      
      console.log(`✅ Parsed ${result.totalItems} items in ${processingTimeMs}ms`);
      console.log(`💰 Cost: $${this.totalCost.toFixed(4)} (${this.totalTokensUsed} tokens)`);
      
      return result;

    } catch (error) {
      console.error('❌ LLM parsing failed:', error);
      throw error;
    }
  }

  /**
   * Intelligent chunking that respects natural boundaries
   */
  private intelligentChunking(transcript: ProcessedTranscript, sourceType?: string): ChunkInfo[] {
    const chunks: ChunkInfo[] = [];
    const segments = transcript.segments;
    
    // Adjust chunk size and overlap based on source type
    const maxTokensForType = sourceType === 'news' ? 6000 : this.maxTokensPerChunk;
    const overlapForType = sourceType === 'news' ? 0.2 : this.overlapRatio;
    
    if (segments.length === 0) {
      // Fallback: simple text chunking
      return this.simpleTextChunking(transcript.text, maxTokensForType);
    }
    
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
      
      const batchPromises = batch.map(chunk => 
        this.processChunk(chunk, request)
      );
      
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
   * Process a single chunk with LLM
   */
  private async processChunk(chunk: ChunkInfo, request: ParseRequest): Promise<any> {
    const prompt = this.buildPrompt(chunk, request);
    
    try {
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
        response_format: { type: 'json_object' },
        temperature: 0.1, // Low temperature for consistent parsing
        max_tokens: 1500, // Reasonable limit for responses
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

      return JSON.parse(content);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Chunk processing failed:', errorMessage);
      return { items: [], error: errorMessage };
    }
  }

  /**
   * Build prompt for chunk processing
   */
  private buildPrompt(chunk: ChunkInfo, request: ParseRequest): string {
    const metadata = request.videoMetadata;
    const timeInfo = chunk.startTime > 0 ? 
      `\nTiming: ${this.formatTime(chunk.startTime)} - ${this.formatTime(chunk.endTime)}` : '';
    
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

Example: A new ChatGPT feature = 8, a research paper = 6, a minor bug fix = 3.`;
  }

  /**
   * Get system prompt based on source type
   */
  private getSystemPrompt(sourceType: 'news' | 'debate' | 'dev'): string {
    const base = `Du er en ekspert AI-analytiker som ekstraherer strukturert informasjon fra video-transkripsjoner.

KRITISKE REGLER:
- Skriv ALT på norsk
- Ekstraher KUN informasjon som er eksplisitt nevnt i transkripsjonen
- IKKE legg til eksterne kunnskaper eller antakelser
- Vær KONKRET og SPESIFIKK - ikke vag eller generell
- Inkluder tall, navn, versjoner, datoer, benchmarks når nevnt
- Hver item må ha et "rawContext" felt med eksakt tekst-utdrag
- Sett confidence basert på klarhet: high (meget klar), medium (noe klar), low (uklar/implisert)
- Returner gyldig JSON med en "items" array
- Hvis ingen entiteter er klart nevnt, bruk tom array []
- Bruk eksakte type-verdier: release, tool, policy, research, acquisition, funding, other

STRENGE FORMAT-KRAV:
- title: 10-150 tegn (vær beskrivende og konkret)
- summary: 50-250 tegn (MAKS 250 tegn - kort og presist)
- relevance_score: ALLTID inkluder som heltall 1-10
- Hold alle tekstfelt innenfor disse strenge grensene`;

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

Eksempel god summary: "OpenAI lanserer ChatGPT Canvas-modus med split-screen editor, versjonskontroll og inline-redigering. Rulles ut til Plus-brukere denne uken, gratis brukere om 2-3 uker."`,

      debate: `
FOKUS PÅ: Diskusjonstemaer, forskjellige synspunkter, argumenter, konsekvenser
EKSTRAHER: topic (10-120 tegn på norsk), whatWasDiscussed (50-400 tegn med SPESIFIKK innhold), pro/contra posisjoner, nøkkelsitater med kontekst, implications (20-300 tegn)
Fang nyansene i forskjellige perspektiver og HVORFOR temaet betyr noe.
Vær KONKRET om hva som faktisk ble diskutert - ikke vag om "diverse synspunkter". Inkluder spesifikke argumenter, eksempler og sitater.

PÅKREVDE FELTER for debate-items:
- positions: ALLTID inkluder objekt med {"pro": [], "contra": []} arrays. Hvis ingen argumenter nevnt, bruk tomme arrays.
- keyQuotes: ALLTID inkluder array med sitater. Hvis ingen sitater, bruk tom array [].
- Hvert sitat må ha: quote, timestamp (HH:MM:SS format), og eventuelt speaker og context.
- relevance_score: ALLTID inkluder som heltall 1-10`,

      dev: `
FOKUS PÅ: Verktøylanseringer, API-endringer, tutorials, kodeeksempler, utviklerressurser
EKSTRAHER: title (10-150 tegn på norsk), whatChanged (20-300 tegn med SPESIFIKKE detaljer), hvordan det påvirker utviklere, nødvendige handlinger, lenker/ressurser nevnt
Prioriter KONKRET informasjon utviklere kan bruke umiddelbart. 
Inkluder versjonnumre, nye metoder/funksjoner, breaking changes, installasjonsinstruksjoner, API-endepunkt hvis nevnt.
Eksempel: "GitHub Copilot får nye @workspace kommando som lar deg referere hele prosjektet. Tilgjengelig i VS Code 1.85+ via Copilot Chat panel."

PÅKREVDE FELTER for dev-items:
- changeType: ALLTID spesifiser en av: release, breaking, feature, tutorial, tool, api, framework, library
- developerAction: ALLTID spesifiser en av: try, update, evaluate, migrate, test, learn
- whatChanged: ALLTID inkluder spesifikke detaljer om hva som er nytt/endret (20-300 tegn)
- links: ALLTID inkluder array med URL-er nevnt i videoen. Hvis ingen lenker nevnt, bruk tom array []
- relevance_score: ALLTID inkluder som heltall 1-10`
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
}
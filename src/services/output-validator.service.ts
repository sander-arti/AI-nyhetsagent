import { ParsedItem, NewsItem, DebateItem, DevItem, validateItem } from '../types/schemas.js';
import { ChunkInfo } from './llm.service.js';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  perfectMatch: boolean;
  confidenceAdjustment: number; // -1.0 to 1.0
}

export interface ItemValidationResult {
  item: ParsedItem;
  validation: ValidationResult;
  shouldRetry: boolean;
  enhancedPromptSuggestions?: string[];
}

export class OutputValidatorService {
  /**
   * Validate extracted items against transcript and context
   */
  async validateExtractedItems(
    items: any[],
    chunk: ChunkInfo,
    sourceType: 'news' | 'debate' | 'dev'
  ): Promise<ItemValidationResult[]> {
    const results: ItemValidationResult[] = [];

    for (const item of items) {
      const validation = await this.validateItem(item, chunk, sourceType);
      results.push(validation);
    }

    return results;
  }

  /**
   * Validate a single item thoroughly
   */
  private async validateItem(
    item: any,
    chunk: ChunkInfo,
    sourceType: 'news' | 'debate' | 'dev'
  ): Promise<ItemValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let confidenceAdjustment = 0;

    // 1. Schema validation (Zod)
    const schemaValidation = validateItem(item, sourceType);
    if (!schemaValidation.valid) {
      errors.push(...(schemaValidation.errors || []));
      return {
        item,
        validation: {
          isValid: false,
          errors,
          warnings,
          perfectMatch: false,
          confidenceAdjustment: -1.0
        },
        shouldRetry: true,
        enhancedPromptSuggestions: [
          'Ensure all required fields are present',
          'Follow the exact schema structure',
          ...schemaValidation.errors?.map(e => `Fix: ${e}`) || []
        ]
      };
    }

    const validatedItem = schemaValidation.item!;

    // 2. RawContext validation
    if (!validatedItem.rawContext || validatedItem.rawContext.length < 20) {
      errors.push('rawContext is too short or missing');
      confidenceAdjustment -= 0.3;
    }

    // 3. Entity verification - check if entities actually appear in rawContext
    if ('entities' in validatedItem && validatedItem.entities) {
      const missingEntities = this.verifyEntities(
        validatedItem.entities,
        validatedItem.rawContext,
        chunk.text
      );

      if (missingEntities.length > 0) {
        warnings.push(`Entities not found in context: ${missingEntities.join(', ')}`);
        confidenceAdjustment -= 0.2 * (missingEntities.length / validatedItem.entities.length);
      }
    }

    // 4. Verify rawContext exists in transcript
    if (!this.contextExistsInTranscript(validatedItem.rawContext, chunk.text)) {
      errors.push('rawContext does not appear in transcript - possible hallucination');
      confidenceAdjustment -= 0.5;
    }

    // 5. Check timestamp validity
    if (validatedItem.timestamp) {
      const timestampValidation = this.validateTimestamp(
        validatedItem.timestamp,
        chunk.startTime,
        chunk.endTime
      );
      if (!timestampValidation.valid) {
        warnings.push(timestampValidation.error!);
        confidenceAdjustment -= 0.1;
      }
    }

    // 6. Content length checks
    const lengthValidation = this.validateContentLengths(validatedItem, sourceType);
    if (!lengthValidation.valid) {
      warnings.push(...lengthValidation.warnings);
      confidenceAdjustment -= 0.1;
    }

    // 7. Relevance score sanity check
    if (validatedItem.relevance_score) {
      const relevanceCheck = this.validateRelevanceScore(validatedItem, sourceType);
      if (!relevanceCheck.valid) {
        warnings.push(relevanceCheck.warning!);
        confidenceAdjustment -= 0.05;
      }
    }

    // 8. Type-specific validation
    const typeValidation = this.validateTypeSpecific(validatedItem, sourceType, chunk);
    errors.push(...typeValidation.errors);
    warnings.push(...typeValidation.warnings);
    confidenceAdjustment += typeValidation.confidenceAdjustment;

    // Determine if retry is needed
    const shouldRetry = errors.length > 0 || confidenceAdjustment < -0.4;

    // Build enhanced prompt suggestions for retry
    const enhancedPromptSuggestions = shouldRetry ? this.buildPromptSuggestions(
      errors,
      warnings,
      validatedItem
    ) : undefined;

    return {
      item: validatedItem,
      validation: {
        isValid: errors.length === 0,
        errors,
        warnings,
        perfectMatch: errors.length === 0 && warnings.length === 0 && confidenceAdjustment >= 0,
        confidenceAdjustment
      },
      shouldRetry,
      enhancedPromptSuggestions
    };
  }

  /**
   * Verify that entities actually appear in the context
   */
  private verifyEntities(
    entities: string[],
    rawContext: string,
    fullText: string
  ): string[] {
    const missingEntities: string[] = [];

    for (const entity of entities) {
      // Try exact match first
      const exactMatch = rawContext.includes(entity) || fullText.includes(entity);

      if (!exactMatch) {
        // Try fuzzy match (case-insensitive, partial)
        const fuzzyMatch = this.fuzzyMatchEntity(entity, rawContext) ||
                          this.fuzzyMatchEntity(entity, fullText);

        if (!fuzzyMatch) {
          missingEntities.push(entity);
        }
      }
    }

    return missingEntities;
  }

  /**
   * Fuzzy match for entity names (handles variations like "OpenAI" vs "Open AI")
   */
  private fuzzyMatchEntity(entity: string, text: string): boolean {
    const normalized = entity.toLowerCase().replace(/[^a-z0-9]/g, '');
    const textNormalized = text.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Check if normalized entity appears in text
    if (textNormalized.includes(normalized)) {
      return true;
    }

    // Check for common variations
    const variations = [
      entity.replace(/\s+/g, ''),  // Remove spaces: "Open AI" → "OpenAI"
      entity.replace(/([A-Z])/g, ' $1').trim(),  // Add spaces: "OpenAI" → "Open AI"
      entity.replace(/-/g, ' '),  // Replace hyphens: "GPT-4" → "GPT 4"
      entity.replace(/\s+/g, '-')  // Replace spaces: "Claude AI" → "Claude-AI"
    ];

    for (const variation of variations) {
      if (text.toLowerCase().includes(variation.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if rawContext actually exists in transcript (prevent complete fabrication)
   */
  private contextExistsInTranscript(rawContext: string, fullText: string): boolean {
    // Remove extra whitespace for comparison
    const cleanContext = rawContext.trim().replace(/\s+/g, ' ');
    const cleanText = fullText.trim().replace(/\s+/g, ' ');

    // Check for exact match (with some tolerance)
    if (cleanText.includes(cleanContext)) {
      return true;
    }

    // Check for substantial overlap (at least 70% of words should match)
    const contextWords = cleanContext.toLowerCase().split(' ');
    const textWords = cleanText.toLowerCase().split(' ');

    let matchingWords = 0;
    for (const word of contextWords) {
      if (word.length > 3 && textWords.includes(word)) {  // Skip short words
        matchingWords++;
      }
    }

    const overlapRatio = matchingWords / contextWords.length;
    return overlapRatio >= 0.7;  // At least 70% word overlap
  }

  /**
   * Validate timestamp is within chunk boundaries
   */
  private validateTimestamp(
    timestamp: string,
    chunkStart: number,
    chunkEnd: number
  ): { valid: boolean; error?: string } {
    const timestampSeconds = this.parseTimestamp(timestamp);

    if (timestampSeconds < 0) {
      return { valid: false, error: 'Invalid timestamp format' };
    }

    if (timestampSeconds < chunkStart || timestampSeconds > chunkEnd) {
      return {
        valid: false,
        error: `Timestamp ${timestamp} is outside chunk range ${this.formatTime(chunkStart)}-${this.formatTime(chunkEnd)}`
      };
    }

    return { valid: true };
  }

  /**
   * Parse HH:MM:SS timestamp to seconds
   */
  private parseTimestamp(timestamp: string): number {
    const parts = timestamp.split(':');
    if (parts.length !== 3) return -1;

    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(parts[2], 10);

    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return -1;

    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Format seconds to HH:MM:SS
   */
  private formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Validate content length guidelines
   */
  private validateContentLengths(
    item: ParsedItem,
    sourceType: string
  ): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];

    // Check title length (if applicable)
    if ('title' in item && item.title) {
      if (item.title.length < 10) {
        warnings.push('Title is very short - should be more descriptive');
      }
      if (item.title.length > 100) {
        warnings.push('Title is too long - should be concise');
      }
    }

    // Check summary length (if applicable)
    if ('summary' in item && item.summary) {
      if (item.summary.length < 20) {
        warnings.push('Summary is too short - needs more detail');
      }
      if (item.summary.length > 240) {
        warnings.push('Summary is too long - should be concise');
      }
    }

    // Check rawContext length
    if (item.rawContext.length > 500) {
      warnings.push('rawContext is very long - should be focused excerpt');
    }

    return { valid: warnings.length === 0, warnings };
  }

  /**
   * Validate relevance score makes sense
   */
  private validateRelevanceScore(
    item: ParsedItem,
    sourceType: string
  ): { valid: boolean; warning?: string } {
    const score = item.relevance_score;

    // Very high scores (9-10) should have high confidence
    if (score >= 9 && item.confidence === 'low') {
      return {
        valid: false,
        warning: 'Relevance score 9-10 with low confidence is suspicious'
      };
    }

    // Very low scores (1-2) should probably be filtered out
    if (score <= 2) {
      return {
        valid: false,
        warning: 'Relevance score 1-2 is very low - consider excluding this item'
      };
    }

    return { valid: true };
  }

  /**
   * Type-specific validation
   */
  private validateTypeSpecific(
    item: ParsedItem,
    sourceType: 'news' | 'debate' | 'dev',
    chunk: ChunkInfo
  ): { errors: string[]; warnings: string[]; confidenceAdjustment: number } {
    const errors: string[] = [];
    const warnings: string[] = [];
    let confidenceAdjustment = 0;

    switch (sourceType) {
      case 'news':
        const newsValidation = this.validateNewsItem(item as NewsItem);
        errors.push(...newsValidation.errors);
        warnings.push(...newsValidation.warnings);
        confidenceAdjustment += newsValidation.confidenceAdjustment;
        break;

      case 'debate':
        const debateValidation = this.validateDebateItem(item as DebateItem);
        errors.push(...debateValidation.errors);
        warnings.push(...debateValidation.warnings);
        confidenceAdjustment += debateValidation.confidenceAdjustment;
        break;

      case 'dev':
        const devValidation = this.validateDevItem(item as DevItem);
        errors.push(...devValidation.errors);
        warnings.push(...devValidation.warnings);
        confidenceAdjustment += devValidation.confidenceAdjustment;
        break;
    }

    return { errors, warnings, confidenceAdjustment };
  }

  /**
   * Validate news-specific fields
   */
  private validateNewsItem(item: NewsItem): {
    errors: string[];
    warnings: string[];
    confidenceAdjustment: number
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    let confidenceAdjustment = 0;

    // Check entities array is not empty for news
    if (!item.entities || item.entities.length === 0) {
      warnings.push('News item should have at least one entity (company, product, etc.)');
      confidenceAdjustment -= 0.1;
    }

    // Validate type makes sense
    if (item.type === 'other') {
      warnings.push('Type "other" suggests unclear categorization');
      confidenceAdjustment -= 0.05;
    }

    return { errors, warnings, confidenceAdjustment };
  }

  /**
   * Validate debate-specific fields
   */
  private validateDebateItem(item: DebateItem): {
    errors: string[];
    warnings: string[];
    confidenceAdjustment: number
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    let confidenceAdjustment = 0;

    // Check that positions have content
    if ((!item.positions.pro || item.positions.pro.length === 0) &&
        (!item.positions.contra || item.positions.contra.length === 0)) {
      warnings.push('Debate item should have at least one pro or contra position');
      confidenceAdjustment -= 0.15;
    }

    // Check implications is meaningful
    if (item.implications.length < 30) {
      warnings.push('Implications should be more detailed');
      confidenceAdjustment -= 0.1;
    }

    return { errors, warnings, confidenceAdjustment };
  }

  /**
   * Validate dev-specific fields
   */
  private validateDevItem(item: DevItem): {
    errors: string[];
    warnings: string[];
    confidenceAdjustment: number
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    let confidenceAdjustment = 0;

    // Check that links array exists (even if empty)
    if (!Array.isArray(item.links)) {
      errors.push('links field must be an array (can be empty)');
    }

    // Validate whatChanged is detailed
    if (item.whatChanged.length < 30) {
      warnings.push('whatChanged should be more specific and detailed');
      confidenceAdjustment -= 0.1;
    }

    return { errors, warnings, confidenceAdjustment };
  }

  /**
   * Build enhanced prompt suggestions for retry
   */
  private buildPromptSuggestions(
    errors: string[],
    warnings: string[],
    item: ParsedItem
  ): string[] {
    const suggestions: string[] = [];

    if (errors.length > 0) {
      suggestions.push('CRITICAL ERRORS TO FIX:');
      suggestions.push(...errors.map(e => `- ${e}`));
    }

    if (warnings.length > 0) {
      suggestions.push('WARNINGS TO ADDRESS:');
      suggestions.push(...warnings.map(w => `- ${w}`));
    }

    suggestions.push('');
    suggestions.push('REMEMBER:');
    suggestions.push('- Only extract information EXPLICITLY stated in the transcript');
    suggestions.push('- rawContext must be an EXACT quote from the transcript');
    suggestions.push('- All entities must actually appear in rawContext or transcript');
    suggestions.push('- When in doubt, set confidence to "low" or skip the item');

    return suggestions;
  }
}

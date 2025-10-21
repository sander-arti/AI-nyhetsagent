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
  private validationMode: 'strict' | 'moderate' | 'lenient' = 'strict';
  private validationAttempt: number = 0;

  /**
   * Set validation mode based on retry attempt
   */
  setValidationMode(attempt: number): void {
    this.validationAttempt = attempt;
    if (attempt === 0) {
      this.validationMode = 'strict';    // 70% threshold
    } else if (attempt === 1) {
      this.validationMode = 'moderate';  // 50% threshold
    } else {
      this.validationMode = 'lenient';   // 30% threshold
    }
    console.log(`🔍 Validation mode: ${this.validationMode} (attempt ${attempt})`);
  }

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

    // Log item being validated
    const itemTitle = item?.title || item?.topic || 'Unknown';
    console.log(`\n🔍 Validating item: "${itemTitle.substring(0, 60)}${itemTitle.length > 60 ? '...' : ''}"`);

    // 1. Schema validation (Zod)
    console.log(`  📋 Step 1: Schema validation...`);
    const schemaValidation = validateItem(item, sourceType);
    if (!schemaValidation.valid) {
      console.log(`  ❌ Schema validation FAILED:`);
      schemaValidation.errors?.forEach((err, i) => {
        console.log(`     ${i + 1}. ${err}`);
      });
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
    console.log(`  ✅ Schema validation PASSED`);

    const validatedItem = schemaValidation.item!;

    // 2. RawContext length validation
    console.log(`  📏 Step 2: RawContext length check...`);
    if (!validatedItem.rawContext || validatedItem.rawContext.length < 20) {
      console.log(`  ❌ rawContext too short: ${validatedItem.rawContext?.length || 0} chars (min 20)`);
      errors.push('rawContext is too short or missing');
      confidenceAdjustment -= 0.3;
    } else {
      console.log(`  ✅ rawContext length OK: ${validatedItem.rawContext.length} chars`);
    }

    // 3. Entity verification - check if entities actually appear in rawContext
    console.log(`  🏷️  Step 3: Entity verification...`);
    if ('entities' in validatedItem && validatedItem.entities) {
      const missingEntities = this.verifyEntities(
        validatedItem.entities,
        validatedItem.rawContext,
        chunk.text
      );

      if (missingEntities.length > 0) {
        console.log(`  ⚠️  Entities not found in context: ${missingEntities.join(', ')}`);
        warnings.push(`Entities not found in context: ${missingEntities.join(', ')}`);
        confidenceAdjustment -= 0.2 * (missingEntities.length / validatedItem.entities.length);
      } else {
        console.log(`  ✅ All ${validatedItem.entities.length} entities verified`);
      }
    } else {
      console.log(`  ℹ️  No entities to verify`);
    }

    // 4. Verify rawContext exists in transcript
    console.log(`  🔎 Step 4: RawContext transcript match...`);
    if (!this.contextExistsInTranscript(validatedItem.rawContext, chunk.text)) {
      console.log(`  ❌ rawContext NOT found in transcript - possible hallucination`);
      errors.push('rawContext does not appear in transcript - possible hallucination');
      confidenceAdjustment -= 0.5;
    }
    // Note: contextExistsInTranscript already logs success/failure details

    // 5. Check timestamp validity
    console.log(`  ⏱️  Step 5: Timestamp validation...`);
    if (validatedItem.timestamp) {
      const timestampValidation = this.validateTimestamp(
        validatedItem.timestamp,
        chunk.startTime,
        chunk.endTime
      );
      if (!timestampValidation.valid) {
        console.log(`  ⚠️  ${timestampValidation.error}`);
        warnings.push(timestampValidation.error!);
        confidenceAdjustment -= 0.1;
      } else {
        console.log(`  ✅ Timestamp OK: ${validatedItem.timestamp}`);
      }
    } else {
      console.log(`  ℹ️  No timestamp to validate`);
    }

    // 6. Content length checks
    console.log(`  📝 Step 6: Content length validation...`);
    const lengthValidation = this.validateContentLengths(validatedItem, sourceType);
    if (!lengthValidation.valid) {
      console.log(`  ⚠️  Content length issues:`);
      lengthValidation.warnings.forEach((warn, i) => {
        console.log(`     ${i + 1}. ${warn}`);
      });
      warnings.push(...lengthValidation.warnings);
      confidenceAdjustment -= 0.1;
    } else {
      console.log(`  ✅ Content lengths OK`);
    }

    // 7. Relevance score sanity check
    console.log(`  🎯 Step 7: Relevance score validation...`);
    if (validatedItem.relevance_score) {
      const relevanceCheck = this.validateRelevanceScore(validatedItem, sourceType);
      if (!relevanceCheck.valid) {
        console.log(`  ⚠️  ${relevanceCheck.warning}`);
        warnings.push(relevanceCheck.warning!);
        confidenceAdjustment -= 0.05;
      } else {
        console.log(`  ✅ Relevance score OK: ${validatedItem.relevance_score}/10`);
      }
    } else {
      console.log(`  ℹ️  No relevance score to validate`);
    }

    // 8. Type-specific validation
    console.log(`  🔧 Step 8: Type-specific validation (${sourceType})...`);
    const typeValidation = this.validateTypeSpecific(validatedItem, sourceType, chunk);
    if (typeValidation.errors.length > 0) {
      console.log(`  ❌ Type-specific errors:`);
      typeValidation.errors.forEach((err, i) => {
        console.log(`     ${i + 1}. ${err}`);
      });
    }
    if (typeValidation.warnings.length > 0) {
      console.log(`  ⚠️  Type-specific warnings:`);
      typeValidation.warnings.forEach((warn, i) => {
        console.log(`     ${i + 1}. ${warn}`);
      });
    }
    if (typeValidation.errors.length === 0 && typeValidation.warnings.length === 0) {
      console.log(`  ✅ Type-specific validation passed`);
    }
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

    // Final validation summary
    const isValid = errors.length === 0;
    const isPerfect = errors.length === 0 && warnings.length === 0 && confidenceAdjustment >= 0;

    console.log(`\n  📊 Validation Result:`);
    console.log(`     Valid: ${isValid ? '✅ YES' : '❌ NO'}`);
    console.log(`     Errors: ${errors.length}`);
    console.log(`     Warnings: ${warnings.length}`);
    console.log(`     Confidence adjustment: ${confidenceAdjustment.toFixed(2)}`);
    console.log(`     Should retry: ${shouldRetry ? 'YES' : 'NO'}`);

    if (!isValid) {
      console.log(`\n  ❌ FAILED - Errors that prevented validation:`);
      errors.forEach((err, i) => {
        console.log(`     ${i + 1}. ${err}`);
      });
    }

    return {
      item: validatedItem,
      validation: {
        isValid,
        errors,
        warnings,
        perfectMatch: isPerfect,
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
   * Uses adaptive thresholds based on validation mode
   */
  private contextExistsInTranscript(rawContext: string, fullText: string): boolean {
    // Remove extra whitespace for comparison
    const cleanContext = rawContext.trim().replace(/\s+/g, ' ');
    const cleanText = fullText.trim().replace(/\s+/g, ' ');

    // Check for exact match (with some tolerance)
    if (cleanText.includes(cleanContext)) {
      console.log(`  ✅ rawContext: Exact match found`);
      return true;
    }

    // Adaptive threshold based on validation mode
    const thresholds = {
      strict: 0.70,    // 70% word overlap (original)
      moderate: 0.50,  // 50% word overlap (retry 1)
      lenient: 0.30    // 30% word overlap (retry 2+)
    };
    const requiredOverlap = thresholds[this.validationMode];

    // Check for substantial overlap
    const contextWords = cleanContext.toLowerCase().split(' ').filter(w => w.length > 3);
    const textWords = cleanText.toLowerCase().split(' ');

    let matchingWords = 0;
    const missingWords: string[] = [];

    for (const word of contextWords) {
      if (textWords.includes(word)) {
        matchingWords++;
      } else {
        missingWords.push(word);
      }
    }

    const overlapRatio = contextWords.length > 0 ? matchingWords / contextWords.length : 0;
    const passed = overlapRatio >= requiredOverlap;

    // Detailed logging
    if (passed) {
      console.log(`  ✅ rawContext: ${(overlapRatio * 100).toFixed(1)}% overlap (≥${(requiredOverlap * 100).toFixed(0)}% required in ${this.validationMode} mode)`);
    } else {
      console.log(`  ❌ rawContext: ${(overlapRatio * 100).toFixed(1)}% overlap (<${(requiredOverlap * 100).toFixed(0)}% required in ${this.validationMode} mode)`);
      console.log(`     Matching: ${matchingWords}/${contextWords.length} words`);
      if (missingWords.length <= 10) {
        console.log(`     Missing words: ${missingWords.slice(0, 10).join(', ')}`);
      } else {
        console.log(`     Missing ${missingWords.length} words (showing first 10): ${missingWords.slice(0, 10).join(', ')}`);
      }
      console.log(`     rawContext preview: "${cleanContext.substring(0, 100)}..."`);
    }

    return passed;
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

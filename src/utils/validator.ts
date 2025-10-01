import { 
  NewsItem, DebateItem, DevItem, ParsedItem,
  validateItem, SCHEMAS
} from '../types/schemas.js';

export interface ValidationResult {
  valid: boolean;
  item?: ParsedItem;
  errors: string[];
  warnings: string[];
  score: number; // 0-1, overall quality score
}

export interface ValidationOptions {
  strictMode?: boolean;
  checkDuplicates?: boolean;
  validateTimestamps?: boolean;
  validateEntities?: boolean;
  minConfidence?: 'low' | 'medium' | 'high';
}

export class ItemValidator {
  private existingItems: Set<string> = new Set();
  
  constructor() {}

  /**
   * Comprehensive validation of a parsed item
   */
  async validate(
    item: unknown, 
    sourceType: 'news' | 'debate' | 'dev',
    options: ValidationOptions = {}
  ): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      score: 0
    };

    try {
      // 1. Schema validation (Zod)
      const schemaValidation = validateItem(item, sourceType);
      if (!schemaValidation.valid) {
        result.valid = false;
        result.errors.push(...(schemaValidation.errors || ['Schema validation failed']));
        return result;
      }

      const validatedItem = schemaValidation.item!;
      result.item = validatedItem;

      // 2. Content validation
      const contentValidation = await this.validateContent(validatedItem, sourceType, options);
      result.errors.push(...contentValidation.errors);
      result.warnings.push(...contentValidation.warnings);
      result.score = contentValidation.score;

      if (result.errors.length > 0 && options.strictMode) {
        result.valid = false;
      }

      return result;

    } catch (error) {
      result.valid = false;
      result.errors.push(`Validation error: ${error}`);
      return result;
    }
  }

  /**
   * Content-specific validation
   */
  private async validateContent(
    item: ParsedItem, 
    sourceType: 'news' | 'debate' | 'dev',
    options: ValidationOptions
  ): Promise<{ errors: string[]; warnings: string[]; score: number }> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let score = 0.5; // Base score

    // Base validation for all items
    score += this.validateBaseContent(item, errors, warnings);

    // Type-specific validation
    switch (sourceType) {
      case 'news':
        score += this.validateNewsItem(item as NewsItem, errors, warnings);
        break;
      case 'debate':
        score += this.validateDebateItem(item as DebateItem, errors, warnings);
        break;
      case 'dev':
        score += this.validateDevItem(item as DevItem, errors, warnings);
        break;
    }

    // Optional validations
    if (options.validateTimestamps) {
      score += this.validateTimestamp(item, errors, warnings);
    }

    if (options.validateEntities && 'entities' in item) {
      score += this.validateEntities(item.entities as string[], item.rawContext, errors, warnings);
    }

    if (options.checkDuplicates) {
      const isDuplicate = this.checkForDuplicate(item);
      if (isDuplicate) {
        warnings.push('Potential duplicate content detected');
        score -= 0.2;
      }
    }

    if (options.minConfidence) {
      const confidenceScore = { low: 1, medium: 2, high: 3 };
      const requiredScore = confidenceScore[options.minConfidence];
      const actualScore = confidenceScore[item.confidence];
      
      if (actualScore < requiredScore) {
        errors.push(`Confidence ${item.confidence} below required ${options.minConfidence}`);
      }
    }

    return { 
      errors, 
      warnings, 
      score: Math.max(0, Math.min(1, score)) 
    };
  }

  /**
   * Base content validation for all item types
   */
  private validateBaseContent(
    item: ParsedItem, 
    errors: string[], 
    warnings: string[]
  ): number {
    let scoreBonus = 0;

    // Check required fields have meaningful content
    const title = 'title' in item ? item.title : 'topic' in item ? item.topic : '';
    if (!title || title.length < 5) {
      errors.push('Title/topic too short or missing');
    } else {
      scoreBonus += 0.1;
    }

    // Check rawContext exists and is substantial
    if (!item.rawContext || item.rawContext.length < 20) {
      warnings.push('Raw context is missing or too short for verification');
    } else {
      scoreBonus += 0.1;
    }

    // Check confidence is justified
    if (item.confidence === 'high' && !this.isHighConfidenceJustified(item)) {
      warnings.push('High confidence may not be justified by content quality');
    }

    // Check for placeholder content
    if (this.hasPlaceholderContent(item)) {
      errors.push('Contains placeholder or template content');
    }

    return scoreBonus;
  }

  /**
   * News item specific validation
   */
  private validateNewsItem(item: NewsItem, errors: string[], warnings: string[]): number {
    let scoreBonus = 0;

    // Title should be news-like
    if (!this.isNewsTitle(item.title)) {
      warnings.push('Title doesn\'t follow typical news format');
    } else {
      scoreBonus += 0.1;
    }

    // Summary should be informative
    if (item.summary.length < 20) {
      warnings.push('Summary is very brief');
    } else if (item.summary.length > 250) {
      warnings.push('Summary is longer than recommended');
    } else {
      scoreBonus += 0.1;
    }

    // Should have meaningful entities
    if (!item.entities || item.entities.length === 0) {
      warnings.push('No entities identified');
    } else {
      // Check entity quality
      const validEntities = item.entities.filter(e => this.isValidEntity(e));
      if (validEntities.length !== item.entities.length) {
        warnings.push('Some entities may be invalid or too generic');
      }
      scoreBonus += Math.min(0.1, item.entities.length * 0.02);
    }

    // Type should match content
    if (item.type === 'other') {
      warnings.push('Generic type "other" suggests unclear categorization');
    }

    return scoreBonus;
  }

  /**
   * Debate item specific validation
   */
  private validateDebateItem(item: DebateItem, errors: string[], warnings: string[]): number {
    let scoreBonus = 0;

    // Should have positions
    const totalPositions = (item.positions.pro?.length || 0) + (item.positions.contra?.length || 0);
    if (totalPositions === 0) {
      warnings.push('No positions identified for debate topic');
    } else {
      scoreBonus += Math.min(0.15, totalPositions * 0.03);
    }

    // Key quotes should be substantial
    if (item.keyQuotes.length === 0) {
      warnings.push('No key quotes captured');
    } else {
      const validQuotes = item.keyQuotes.filter(q => q.quote.length >= 10);
      if (validQuotes.length !== item.keyQuotes.length) {
        warnings.push('Some quotes are too short to be meaningful');
      }
      scoreBonus += Math.min(0.1, validQuotes.length * 0.02);
    }

    // Implications should be meaningful
    if (!item.implications || item.implications.length < 20) {
      warnings.push('Implications are missing or too brief');
    } else {
      scoreBonus += 0.1;
    }

    return scoreBonus;
  }

  /**
   * Dev item specific validation
   */
  private validateDevItem(item: DevItem, errors: string[], warnings: string[]): number {
    let scoreBonus = 0;

    // Should have actionable information
    const actionableActions = ['try', 'update', 'migrate', 'test'];
    if (actionableActions.includes(item.developerAction)) {
      scoreBonus += 0.1;
    }

    // Links should be valid
    if (item.links && item.links.length > 0) {
      const validLinks = item.links.filter(link => this.isValidUrl(link));
      if (validLinks.length !== item.links.length) {
        warnings.push('Some links may be invalid');
      } else {
        scoreBonus += Math.min(0.1, item.links.length * 0.02);
      }
    }

    // Should identify affected technologies
    if (!item.affectedTechnologies || item.affectedTechnologies.length === 0) {
      warnings.push('No affected technologies identified');
    } else {
      scoreBonus += Math.min(0.1, item.affectedTechnologies.length * 0.01);
    }

    // Code examples add value
    if (item.codeExample && item.codeExample.length > 10) {
      scoreBonus += 0.05;
    }

    return scoreBonus;
  }

  /**
   * Timestamp validation
   */
  private validateTimestamp(item: ParsedItem, errors: string[], warnings: string[]): number {
    if (!item.timestamp) {
      warnings.push('No timestamp provided');
      return 0;
    }

    const timestampRegex = /^\d{1,2}:\d{2}(:\d{2})?$/;
    if (!timestampRegex.test(item.timestamp)) {
      warnings.push('Timestamp format may be invalid');
      return 0;
    }

    return 0.05;
  }

  /**
   * Entity validation against raw context
   */
  private validateEntities(
    entities: string[], 
    rawContext: string, 
    errors: string[], 
    warnings: string[]
  ): number {
    if (!rawContext || entities.length === 0) return 0;

    const lowerContext = rawContext.toLowerCase();
    let validEntityCount = 0;

    for (const entity of entities) {
      if (lowerContext.includes(entity.toLowerCase())) {
        validEntityCount++;
      } else {
        warnings.push(`Entity "${entity}" not found in raw context`);
      }
    }

    const validRatio = validEntityCount / entities.length;
    if (validRatio < 0.5) {
      warnings.push('Many entities not verified in raw context');
    }

    return validRatio * 0.1;
  }

  /**
   * Check for duplicate content
   */
  private checkForDuplicate(item: ParsedItem): boolean {
    const key = this.generateItemKey(item);
    if (this.existingItems.has(key)) {
      return true;
    }
    this.existingItems.add(key);
    return false;
  }

  /**
   * Generate unique key for duplicate detection
   */
  private generateItemKey(item: ParsedItem): string {
    const title = 'title' in item ? item.title : 'topic' in item ? item.topic : '';
    return title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50);
  }

  /**
   * Helper: Check if title follows news format
   */
  private isNewsTitle(title: string): boolean {
    const newsPatterns = [
      /announces?/i, /releases?/i, /launches?/i, /introduces?/i,
      /reports?/i, /reveals?/i, /updates?/i, /acquires?/i
    ];
    return newsPatterns.some(pattern => pattern.test(title));
  }

  /**
   * Helper: Check if entity is valid
   */
  private isValidEntity(entity: string): boolean {
    if (entity.length < 2) return false;
    if (/^(the|a|an|and|or|but|in|on|at|to|for|of|with|by)$/i.test(entity)) return false;
    return true;
  }

  /**
   * Helper: Check if URL is valid
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Helper: Check if high confidence is justified
   */
  private isHighConfidenceJustified(item: ParsedItem): boolean {
    // Simple heuristics for high confidence
    const hasGoodContext = item.rawContext && item.rawContext.length > 50;
    const hasSpecifics = 'entities' in item && item.entities && (item.entities as string[]).length > 0;
    const hasTimestamp = !!item.timestamp;
    
    return hasGoodContext && (hasSpecifics || hasTimestamp);
  }

  /**
   * Helper: Check for placeholder content
   */
  private hasPlaceholderContent(item: ParsedItem): boolean {
    const placeholders = [
      'lorem ipsum', 'placeholder', 'example', 'test data',
      'todo', 'tbd', 'coming soon', '[brackets]'
    ];
    
    const allText = JSON.stringify(item).toLowerCase();
    return placeholders.some(placeholder => allText.includes(placeholder));
  }

  /**
   * Batch validation for multiple items
   */
  async validateBatch(
    items: unknown[], 
    sourceType: 'news' | 'debate' | 'dev',
    options: ValidationOptions = {}
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    
    for (const item of items) {
      const result = await this.validate(item, sourceType, options);
      results.push(result);
    }

    return results;
  }

  /**
   * Get validation statistics
   */
  getBatchStats(results: ValidationResult[]): {
    totalItems: number;
    validItems: number;
    averageScore: number;
    errorCount: number;
    warningCount: number;
  } {
    return {
      totalItems: results.length,
      validItems: results.filter(r => r.valid).length,
      averageScore: results.reduce((sum, r) => sum + r.score, 0) / results.length,
      errorCount: results.reduce((sum, r) => sum + r.errors.length, 0),
      warningCount: results.reduce((sum, r) => sum + r.warnings.length, 0)
    };
  }

  /**
   * Clear existing items cache
   */
  clearCache(): void {
    this.existingItems.clear();
  }
}
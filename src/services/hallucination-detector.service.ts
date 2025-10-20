import { ParsedItem, NewsItem, DebateItem, DevItem } from '../types/schemas.js';
import { EmbeddingService } from './embedding.service.js';

export interface HallucinationCheck {
  hasHallucinations: boolean;
  confidence: number; // 0-1, how confident we are this is NOT a hallucination
  issues: HallucinationIssue[];
  recommendedConfidenceAdjustment: 'high' | 'medium' | 'low' | 'reject';
}

export interface HallucinationIssue {
  type: 'missing_entity' | 'unsupported_claim' | 'semantic_mismatch' | 'fabricated_detail';
  severity: 'critical' | 'major' | 'minor';
  description: string;
  evidence?: string;
}

export class HallucinationDetectorService {
  private embeddingService: EmbeddingService;

  constructor(openaiApiKey: string) {
    this.embeddingService = new EmbeddingService(openaiApiKey);
  }

  /**
   * Comprehensive hallucination detection for extracted item
   */
  async detectHallucinations(
    item: ParsedItem,
    fullTranscript: string
  ): Promise<HallucinationCheck> {
    const issues: HallucinationIssue[] = [];

    // Check 1: Entity verification
    const entityIssues = await this.checkEntityHallucinations(item, fullTranscript);
    issues.push(...entityIssues);

    // Check 2: Claim verification
    const claimIssues = await this.checkClaimHallucinations(item, fullTranscript);
    issues.push(...claimIssues);

    // Check 3: Semantic consistency
    const semanticIssues = await this.checkSemanticConsistency(item);
    issues.push(...semanticIssues);

    // Check 4: Specific detail verification
    const detailIssues = this.checkFabricatedDetails(item, fullTranscript);
    issues.push(...detailIssues);

    // Calculate overall confidence
    const confidence = this.calculateConfidence(issues);

    // Determine if this is a hallucination
    const criticalIssues = issues.filter(i => i.severity === 'critical').length;
    const majorIssues = issues.filter(i => i.severity === 'major').length;

    const hasHallucinations = criticalIssues > 0 || majorIssues >= 2;

    // Recommend confidence adjustment
    const recommendedConfidenceAdjustment = this.recommendConfidenceAdjustment(
      issues,
      confidence
    );

    return {
      hasHallucinations,
      confidence,
      issues,
      recommendedConfidenceAdjustment
    };
  }

  /**
   * Check 1: Verify entities actually appear in transcript
   */
  private async checkEntityHallucinations(
    item: ParsedItem,
    fullTranscript: string
  ): Promise<HallucinationIssue[]> {
    const issues: HallucinationIssue[] = [];

    if ('entities' in item && item.entities && Array.isArray(item.entities)) {
      for (const entity of item.entities) {
        // Check in rawContext first (most important)
        const inRawContext = this.fuzzyContains(item.rawContext, entity);

        // Check in full transcript (fallback)
        const inFullTranscript = this.fuzzyContains(fullTranscript, entity);

        if (!inRawContext && !inFullTranscript) {
          issues.push({
            type: 'missing_entity',
            severity: 'critical',
            description: `Entity "${entity}" does not appear in transcript or rawContext`,
            evidence: `Searched in: "${item.rawContext.substring(0, 100)}..."`
          });
        } else if (!inRawContext && inFullTranscript) {
          issues.push({
            type: 'missing_entity',
            severity: 'major',
            description: `Entity "${entity}" found in transcript but not in rawContext`,
            evidence: 'Entity should be mentioned in the context excerpt'
          });
        }
      }
    }

    return issues;
  }

  /**
   * Check 2: Verify claims are supported by transcript
   */
  private async checkClaimHallucinations(
    item: ParsedItem,
    fullTranscript: string
  ): Promise<HallucinationIssue[]> {
    const issues: HallucinationIssue[] = [];

    // Extract main claim from summary/whatChanged/whatWasDiscussed
    const mainClaim = this.extractMainClaim(item);

    if (mainClaim) {
      // Check if main claim has support in rawContext
      const keywords = this.extractKeywords(mainClaim);
      const supportingKeywords = keywords.filter(kw =>
        this.fuzzyContains(item.rawContext, kw)
      );

      const supportRatio = supportingKeywords.length / keywords.length;

      if (supportRatio < 0.5) {
        issues.push({
          type: 'unsupported_claim',
          severity: supportRatio < 0.3 ? 'critical' : 'major',
          description: `Main claim has weak support in rawContext (${Math.round(supportRatio * 100)}% keywords found)`,
          evidence: `Missing keywords: ${keywords.filter(kw => !this.fuzzyContains(item.rawContext, kw)).join(', ')}`
        });
      }
    }

    return issues;
  }

  /**
   * Check 3: Semantic consistency between summary and rawContext
   */
  private async checkSemanticConsistency(
    item: ParsedItem
  ): Promise<HallucinationIssue[]> {
    const issues: HallucinationIssue[] = [];

    const claim = this.extractMainClaim(item);
    if (!claim || !item.rawContext) {
      return issues;
    }

    try {
      // Generate embeddings for both
      const claimEmbedding = await this.embeddingService.generateEmbedding(claim);
      const contextEmbedding = await this.embeddingService.generateEmbedding(item.rawContext);

      // Calculate cosine similarity
      const similarity = this.cosineSimilarity(claimEmbedding, contextEmbedding);

      // Low similarity indicates potential hallucination
      if (similarity < 0.5) {
        issues.push({
          type: 'semantic_mismatch',
          severity: similarity < 0.3 ? 'critical' : 'major',
          description: `Low semantic similarity between claim and rawContext (${(similarity * 100).toFixed(0)}%)`,
          evidence: `Claim and context appear to be about different topics`
        });
      } else if (similarity < 0.65) {
        issues.push({
          type: 'semantic_mismatch',
          severity: 'minor',
          description: `Moderate semantic similarity (${(similarity * 100).toFixed(0)}%) - verify accuracy`,
          evidence: `Some divergence between claim and supporting context`
        });
      }
    } catch (error) {
      // If embedding fails, don't add issue
      console.warn('Semantic consistency check failed:', error);
    }

    return issues;
  }

  /**
   * Check 4: Detect fabricated specific details (numbers, versions, dates)
   */
  private checkFabricatedDetails(
    item: ParsedItem,
    fullTranscript: string
  ): HallucinationIssue[] {
    const issues: HallucinationIssue[] = [];

    const mainClaim = this.extractMainClaim(item);
    if (!mainClaim) return issues;

    // Extract specific details from claim
    const numbers = this.extractNumbers(mainClaim);
    const versions = this.extractVersions(mainClaim);
    const dates = this.extractDates(mainClaim);

    // Check if these specifics appear in rawContext
    for (const number of numbers) {
      if (!item.rawContext.includes(number) && !fullTranscript.includes(number)) {
        issues.push({
          type: 'fabricated_detail',
          severity: 'critical',
          description: `Specific number "${number}" not found in transcript`,
          evidence: `Number appears in claim but not in source material`
        });
      }
    }

    for (const version of versions) {
      if (!item.rawContext.includes(version) && !fullTranscript.includes(version)) {
        issues.push({
          type: 'fabricated_detail',
          severity: 'critical',
          description: `Version "${version}" not found in transcript`,
          evidence: `Version number appears in claim but not in source`
        });
      }
    }

    for (const date of dates) {
      if (!this.fuzzyDateMatch(item.rawContext, date) && !this.fuzzyDateMatch(fullTranscript, date)) {
        issues.push({
          type: 'fabricated_detail',
          severity: 'major',
          description: `Date "${date}" not found in transcript`,
          evidence: `Specific date may be fabricated or inferred`
        });
      }
    }

    return issues;
  }

  /**
   * Extract main claim from item
   */
  private extractMainClaim(item: ParsedItem): string {
    if ('summary' in item && item.summary) {
      return item.summary;
    } else if ('whatChanged' in item && item.whatChanged) {
      return item.whatChanged;
    } else if ('whatWasDiscussed' in item && item.whatWasDiscussed) {
      return item.whatWasDiscussed;
    } else if ('title' in item && item.title) {
      return item.title;
    } else if ('topic' in item && item.topic) {
      return item.topic;
    }
    return '';
  }

  /**
   * Extract keywords from text (content words, not stop words)
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set(['og', 'i', 'på', 'med', 'til', 'for', 'av', 'er', 'som', 'det', 'en', 'et', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were']);

    const words = text.toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    return [...new Set(words)]; // Unique keywords
  }

  /**
   * Extract numbers from text
   */
  private extractNumbers(text: string): string[] {
    const numberPattern = /\b\d+(?:[.,]\d+)?(?:\s*%|x|X)?\b/g;
    return (text.match(numberPattern) || []).map(n => n.trim());
  }

  /**
   * Extract version numbers (e.g., "GPT-4", "v1.5", "3.5")
   */
  private extractVersions(text: string): string[] {
    const versionPatterns = [
      /\b[a-zA-Z]+-?\d+(?:\.\d+)*\b/g,  // GPT-4, v1.5, Claude-3
      /\bv?\d+\.\d+(?:\.\d+)?\b/g       // v1.5, 3.5.1
    ];

    const versions: string[] = [];
    for (const pattern of versionPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        versions.push(...matches);
      }
    }

    return [...new Set(versions)];
  }

  /**
   * Extract dates from text
   */
  private extractDates(text: string): string[] {
    const datePatterns = [
      /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,  // 20.10.2025, 20/10/25
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi,  // January 20, 2025
      /\b\d{4}\b/g  // Year only: 2025
    ];

    const dates: string[] = [];
    for (const pattern of datePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        dates.push(...matches);
      }
    }

    return [...new Set(dates)];
  }

  /**
   * Fuzzy contains check (case-insensitive, handles variations)
   */
  private fuzzyContains(text: string, search: string): boolean {
    const normalizedText = text.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedSearch = search.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (normalizedText.includes(normalizedSearch)) {
      return true;
    }

    // Check for partial matches (for compound names)
    const searchWords = search.toLowerCase().split(/\s+/);
    const matchedWords = searchWords.filter(word =>
      word.length > 2 && text.toLowerCase().includes(word)
    );

    return matchedWords.length >= Math.ceil(searchWords.length * 0.7); // 70% of words must match
  }

  /**
   * Fuzzy date matching
   */
  private fuzzyDateMatch(text: string, date: string): boolean {
    // Direct match
    if (text.includes(date)) {
      return true;
    }

    // Extract year from date and check
    const yearMatch = date.match(/\b(20\d{2})\b/);
    if (yearMatch && text.includes(yearMatch[1])) {
      return true;
    }

    return false;
  }

  /**
   * Calculate cosine similarity between embeddings
   */
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Calculate overall confidence based on issues
   */
  private calculateConfidence(issues: HallucinationIssue[]): number {
    if (issues.length === 0) {
      return 1.0;
    }

    let penalty = 0;
    for (const issue of issues) {
      if (issue.severity === 'critical') {
        penalty += 0.4;
      } else if (issue.severity === 'major') {
        penalty += 0.2;
      } else {
        penalty += 0.1;
      }
    }

    return Math.max(0, 1.0 - penalty);
  }

  /**
   * Recommend confidence adjustment based on hallucination check
   */
  private recommendConfidenceAdjustment(
    issues: HallucinationIssue[],
    confidence: number
  ): 'high' | 'medium' | 'low' | 'reject' {
    const criticalCount = issues.filter(i => i.severity === 'critical').length;
    const majorCount = issues.filter(i => i.severity === 'major').length;

    if (criticalCount > 0) {
      return 'reject';  // Critical issues = reject item entirely
    }

    if (majorCount >= 2) {
      return 'low';  // Multiple major issues = low confidence only
    }

    if (confidence >= 0.8) {
      return 'high';
    } else if (confidence >= 0.6) {
      return 'medium';
    } else {
      return 'low';
    }
  }
}

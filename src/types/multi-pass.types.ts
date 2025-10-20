/**
 * Multi-Pass Extraction Type Definitions
 *
 * Types for the 3-pass extraction strategy:
 * - Pass 1: Broad extraction
 * - Pass 2: Gap filling
 * - Pass 3: Refinement
 */

export interface GapAnalysis {
  uncoveredRanges: Array<{
    start: number;
    end: number;
    duration: number;
  }>;
  incompletePatterns: string[];
  uncoveredEntities: string[];
  shouldRunPass2: boolean;
}

export interface MultiPassMetrics {
  pass1Items: number;
  pass2Items: number;
  pass3Improvements: number;
  totalCost: number;
  totalTime: number;
  skippedPasses: string[]; // ['pass2', 'pass3']
}

export interface MultiPassConfig {
  enablePass1: boolean;
  enablePass2: boolean;
  enablePass3: boolean;
  minConfidenceForSkipPass2: number;
  maxItemsBeforeRefinement: number;
}

export interface MultiPassResult {
  items: any[];
  passMetrics: MultiPassMetrics;
  validItems: number;
  cost: number;
}

export interface Pass1Result {
  items: any[];
  validItems: number;
  cost: number;
  processingTimeMs: number;
}

export interface Pass2Result {
  items: any[];
  cost: number;
}

export interface Pass3Result {
  items: any[];
  cost: number;
  improvements: number;
}

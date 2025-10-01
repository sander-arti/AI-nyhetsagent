import { z } from 'zod';

// Base schema som alle items arver fra
export const BaseItemSchema = z.object({
  videoId: z.string(),
  channelId: z.string(),
  sourceUrl: z.string().url(),
  timestamp: z.string().optional(), // Format: HH:MM:SS
  confidence: z.enum(['high', 'medium', 'low']),
  rawContext: z.string(), // Original tekst fra transkript for etterprøvbarhet
  qualityScore: z.number().min(0).max(1).optional(),
  relevance_score: z.number().int().min(1).max(10), // LLM-based importance score
});

// Del 1: Nyheter & oppdateringer
export const NewsItemSchema = BaseItemSchema.extend({
  title: z.string().min(5).max(120), // Kort men beskrivende
  summary: z.string().min(10).max(250), // Maks 1-2 setninger
  entities: z.array(z.string()).min(0).default([]), // Selskaper, produkter, personer
  type: z.enum([
    'release',     // Produktlansering
    'tool',        // Nytt verktøy
    'policy',      // Retningslinjer/regulering
    'research',    // Forskningsresultater
    'acquisition', // Oppkjøp/partnerships
    'funding',     // Investering/finansiering
    'other'        // Annet relevant
  ]).transform(val => {
    // Handle common LLM variations
    const mapping: Record<string, string> = {
      'research finding': 'research',
      'policy change': 'policy',
      'product release': 'release',
      'new tool': 'tool'
    };
    return mapping[val] || val;
  }),
  impact: z.enum(['breaking', 'significant', 'minor']).optional(),
  affectedCompanies: z.array(z.string()).optional(),
});

// Del 2: Tema, debatter & perspektiver  
export const DebateItemSchema = BaseItemSchema.extend({
  topic: z.string().min(5).max(100),
  whatWasDiscussed: z.string().min(20).max(400),
  positions: z.object({
    pro: z.array(z.string()).default([]),
    contra: z.array(z.string()).default([]),
    neutral: z.array(z.string()).default([]).optional(),
  }),
  keyQuotes: z.array(z.object({
    quote: z.string().min(10),
    speaker: z.string().optional(),
    timestamp: z.string(), // HH:MM:SS
    context: z.string().optional(),
  })).max(5), // Maks 5 sitater per item
  implications: z.string().min(10).max(300), // Hvorfor det er viktig
  recommendedDeepDive: z.boolean().default(false),
  controversyLevel: z.enum(['low', 'medium', 'high']).optional(),
});

// Del 3: For utviklere
export const DevItemSchema = BaseItemSchema.extend({
  title: z.string().min(5).max(100),
  changeType: z.enum([
    'release',      // Ny versjon/release
    'breaking',     // Breaking changes
    'feature',      // Ny funksjonalitet
    'tutorial',     // How-to/guide
    'tool',         // Nytt utviklerverktøy
    'api',          // API endringer
    'framework',    // Framework updates
    'library'       // Library releases
  ]),
  whatChanged: z.string().min(10).max(300),
  developerAction: z.enum([
    'try',          // Prøv ut nå
    'update',       // Oppdater eksisterende
    'evaluate',     // Vurder for fremtidig bruk
    'migrate',      // Migrer fra gammel løsning
    'test',         // Test kompatibilitet
    'learn'         // Lær ny teknikk
  ]),
  codeExample: z.string().optional(),
  links: z.array(z.string().url()).max(5),
  affectedTechnologies: z.array(z.string()).max(10),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  estimatedTimeToImplement: z.string().optional(), // "2 hours", "1 day", etc.
});

// Unified types
export type BaseItem = z.infer<typeof BaseItemSchema>;
export type NewsItem = z.infer<typeof NewsItemSchema>;
export type DebateItem = z.infer<typeof DebateItemSchema>;
export type DevItem = z.infer<typeof DevItemSchema>;

export type ParsedItem = NewsItem | DebateItem | DevItem;

// Parser output schemas
export const NewsParsingResultSchema = z.object({
  items: z.array(NewsItemSchema),
  totalItemsFound: z.number(),
  averageConfidence: z.number(),
  processingTimeMs: z.number().optional(),
});

export const DebateParsingResultSchema = z.object({
  items: z.array(DebateItemSchema),
  totalItemsFound: z.number(),
  averageConfidence: z.number(),
  processingTimeMs: z.number().optional(),
});

export const DevParsingResultSchema = z.object({
  items: z.array(DevItemSchema),
  totalItemsFound: z.number(),
  averageConfidence: z.number(),
  processingTimeMs: z.number().optional(),
});

// Complete parsing result for a video
export const VideoParsingResultSchema = z.object({
  videoId: z.string(),
  sourceType: z.enum(['news', 'debate', 'dev']),
  newsItems: z.array(NewsItemSchema).optional(),
  debateItems: z.array(DebateItemSchema).optional(),
  devItems: z.array(DevItemSchema).optional(),
  totalItems: z.number(),
  processingTimeMs: z.number(),
  tokensUsed: z.number().optional(),
  estimatedCost: z.number().optional(),
  errors: z.array(z.string()).optional(),
});

export type NewsParsingResult = z.infer<typeof NewsParsingResultSchema>;
export type DebateParsingResult = z.infer<typeof DebateParsingResultSchema>;
export type DevParsingResult = z.infer<typeof DevParsingResultSchema>;
export type VideoParsingResult = z.infer<typeof VideoParsingResultSchema>;

// Confidence scoring helpers
export const ConfidenceFactors = z.object({
  transcriptQuality: z.number().min(0).max(1), // Fra transcript processor
  sourceReliability: z.number().min(0).max(1), // Basert på kanal
  informationClarity: z.number().min(0).max(1), // Hvor tydelig info er
  entityRecognition: z.number().min(0).max(1), // Hvor mange entities vi fant
  timestampAccuracy: z.number().min(0).max(1), // Hvor nøyaktige timestamps er
});

// Validation helpers
export function validateItem(item: unknown, type: 'news' | 'debate' | 'dev'): { valid: boolean; item?: ParsedItem; errors?: string[] } {
  try {
    let validatedItem: ParsedItem;
    
    switch (type) {
      case 'news':
        validatedItem = NewsItemSchema.parse(item);
        break;
      case 'debate':
        validatedItem = DebateItemSchema.parse(item);
        break;
      case 'dev':
        validatedItem = DevItemSchema.parse(item);
        break;
      default:
        return { valid: false, errors: ['Unknown item type'] };
    }
    
    return { valid: true, item: validatedItem };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { 
        valid: false, 
        errors: error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
      };
    }
    return { valid: false, errors: ['Validation failed'] };
  }
}

// Quality scoring
export function calculateConfidenceScore(factors: z.infer<typeof ConfidenceFactors>): 'high' | 'medium' | 'low' {
  const weights = {
    transcriptQuality: 0.3,
    sourceReliability: 0.2,
    informationClarity: 0.25,
    entityRecognition: 0.15,
    timestampAccuracy: 0.1
  };
  
  const weightedScore = 
    factors.transcriptQuality * weights.transcriptQuality +
    factors.sourceReliability * weights.sourceReliability +
    factors.informationClarity * weights.informationClarity +
    factors.entityRecognition * weights.entityRecognition +
    factors.timestampAccuracy * weights.timestampAccuracy;
  
  if (weightedScore >= 0.8) return 'high';
  if (weightedScore >= 0.6) return 'medium';
  return 'low';
}

// Export all schemas for external validation
export const SCHEMAS = {
  BaseItem: BaseItemSchema,
  NewsItem: NewsItemSchema,
  DebateItem: DebateItemSchema,
  DevItem: DevItemSchema,
  NewsParsingResult: NewsParsingResultSchema,
  DebateParsingResult: DebateParsingResultSchema,
  DevParsingResult: DevParsingResultSchema,
  VideoParsingResult: VideoParsingResultSchema,
  ConfidenceFactors,
} as const;
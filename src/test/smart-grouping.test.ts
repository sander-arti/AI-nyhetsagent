import { describe, test, beforeEach, expect } from 'vitest';
import { SmartGroupingService, ParsedItem } from '../services/smart-grouping.service.js';
import { NewsItem, DebateItem, DevItem } from '../types/schemas.js';

// Mock data for testing Alternative B implementation
const mockSoraItems: NewsItem[] = [
  {
    videoId: 'sora1',
    channelId: 'ai_daily',
    sourceUrl: 'https://youtube.com/watch?v=sora1',
    timestamp: '00:05:30',
    confidence: 'high',
    rawContext: 'OpenAI lanserte Sora 2 med forbedret fysikk og realisme',
    qualityScore: 0.9,
    relevance_score: 9,
    title: 'OpenAI lanserer Sora 2 med avanserte videofunksjoner',
    summary: 'Sora 2 kan utføre komplekse fysiske simuleringer som olympiske gymnastikkrutiner og har forbedret realisme i videoene.',
    entities: ['OpenAI', 'Sora 2'],
    type: 'release',
    impact: 'significant'
  },
  {
    videoId: 'sora2',
    channelId: 'matthew_berman',
    sourceUrl: 'https://youtube.com/watch?v=sora2',
    timestamp: '00:12:15',
    confidence: 'high',
    rawContext: 'Sora 2 introduserer Cameo-funksjon for personlig video',
    qualityScore: 0.85,
    relevance_score: 8,
    title: 'Sora 2 introduserer Cameo-funksjon for personlig video',
    summary: 'Den nye Cameo-funksjonen i Sora 2 lar brukere ta opp videoer av seg selv og bruke sitt eget utseende i AI-genererte videoer.',
    entities: ['Sora 2', 'Cameo'],
    type: 'release',
    impact: 'significant'
  }
];

const mockClaudeItems: NewsItem[] = [
  {
    videoId: 'claude1',
    channelId: 'all_in_pod',
    sourceUrl: 'https://youtube.com/watch?v=claude1',
    timestamp: '00:08:45',
    confidence: 'medium',
    rawContext: 'Claude Sonnet 4.5 overgår tidligere modeller i benchmarktester',
    qualityScore: 0.8,
    relevance_score: 8,
    title: 'Claude Sonnet 4.5 overgår GPT5 på SweetBench',
    summary: 'Claude Sonnet 4.5 oppnår 20 prosentpoeng bedre resultater enn GPT5 Codeex og Gemini 2.5 Pro på SweetBench.',
    entities: ['Claude', 'Sonnet 4.5', 'GPT5'],
    type: 'research',
    impact: 'significant'
  },
  {
    videoId: 'claude2',
    channelId: 'cognitive_rev',
    sourceUrl: 'https://youtube.com/watch?v=claude2',
    timestamp: '00:15:20',
    confidence: 'high',
    rawContext: 'Claude Sonnet 4.5 kan tenke autonomt i over 30 timer',
    qualityScore: 0.9,
    relevance_score: 9,
    title: 'Claude Sonnet 4.5 setter ny standard for langvarige oppgaver',
    summary: 'AI-modeller som Claude Sonnet 4.5 kan utføre oppgaver i over 30 timer, en ny Moores lov for AI-kapabiliteter.',
    entities: ['Claude', 'Sonnet 4.5'],
    type: 'research',
    impact: 'breaking'
  }
];

const mockDebateItem: DebateItem = {
  videoId: 'debate_sora',
  channelId: 'debate_channel',
  sourceUrl: 'https://youtube.com/watch?v=debate_sora',
  timestamp: '01:23:45',
  confidence: 'high',
  rawContext: 'Diskusjon om Sora 2s etiske implikasjoner og avhengighetsproblematikk',
  qualityScore: 0.85,
  relevance_score: 7,
  topic: 'Sora 2s etiske implikasjoner',
  whatWasDiscussed: 'Bekymringer om Sora 2 kan føre til oppmerksomhetsavhengighet og negative effekter av AI-generert innhold.',
  positions: {
    pro: ['Fremmer kreativitet', 'Demokratiserer videoskapning'],
    contra: ['Skaper avhengighet', 'Kan misbrukes til desinformasjon']
  },
  keyQuotes: [],
  implications: 'Kan påvirke hvordan vi konsumerer og skaper innhold i fremtiden',
  recommendedDeepDive: true,
  controversyLevel: 'medium'
};

const standaloneItem: NewsItem = {
  videoId: 'standalone',
  channelId: 'tech_news',
  sourceUrl: 'https://youtube.com/watch?v=standalone',
  timestamp: '00:03:10',
  confidence: 'medium',
  rawContext: 'Google oppdaterer Gemini 2.5 Flash Light',
  qualityScore: 0.7,
  relevance_score: 6,
  title: 'Google oppdaterer Gemini 2.5 Flash Light med kostnadsreduksjon',
  summary: 'Google har oppdatert Gemini 2.5 Flash Light for bedre instruksjonsoppfølging, noe som gir 50% kostnadsreduksjon.',
  entities: ['Google', 'Gemini'],
  type: 'tool',
  impact: 'minor'
};

describe('SmartGroupingService - Alternative B Implementation', () => {
  let groupingService: SmartGroupingService;

  beforeEach(() => {
    groupingService = new SmartGroupingService({
      enabled: true,
      minGroupSize: 2,
      preserveDetails: true
    });
  });

  describe('Entity Detection and Grouping', () => {
    test('should detect and group Sora 2 items (2+ items threshold)', async () => {
      const items: ParsedItem[] = [...mockSoraItems, standaloneItem];
      const result = await groupingService.groupItems(items);
      
      expect(result.entityGroups.length).toBe(1);
      expect(result.standaloneItems.length).toBe(1);
      
      const soraGroup = result.entityGroups.find(g => 
        g.entity.toLowerCase().includes('sora')
      );
      
      expect(soraGroup).toBeDefined();
      expect(soraGroup?.totalItems).toBe(2);
      expect(soraGroup?.entityType).toBe('product');
    });

    test('should create separate groups for different entities', async () => {
      const items: ParsedItem[] = [...mockSoraItems, ...mockClaudeItems];
      const result = await groupingService.groupItems(items);
      
      expect(result.entityGroups.length).toBe(2);
      expect(result.standaloneItems.length).toBe(0);
      
      // Should have both Sora and Claude groups
      const entityNames = result.entityGroups.map(g => g.entity.toLowerCase());
      expect(entityNames.some(name => name.includes('sora'))).toBe(true);
      expect(entityNames.some(name => name.includes('claude'))).toBe(true);
    });

    test('should handle mixed item types in same group', async () => {
      const items: ParsedItem[] = [...mockSoraItems, mockDebateItem];
      const result = await groupingService.groupItems(items);
      
      expect(result.entityGroups.length).toBe(1);
      
      const soraGroup = result.entityGroups[0];
      expect(soraGroup.totalItems).toBe(3); // 2 news + 1 debate
      
      // Should preserve different item types
      const itemTypes = soraGroup.items.map(item => item.item.type);
      expect(itemTypes).toContain('release'); // News items have type 'release'
      expect(itemTypes.some(type => type === undefined || type === 'debate')).toBe(true); // Debate items
    });
  });

  describe('Alternative B Hierarchy - Unique Aspects Preservation', () => {
    test('should preserve unique aspects for each item', async () => {
      const items: ParsedItem[] = mockSoraItems;
      const result = await groupingService.groupItems(items);
      
      const soraGroup = result.entityGroups[0];
      
      // Each item should have unique aspects
      soraGroup.items.forEach(groupedItem => {
        expect(groupedItem.uniqueAspect).toBeDefined();
        expect(groupedItem.uniqueAspect.length).toBeGreaterThan(0);
      });
      
      // Unique aspects should be different
      const aspects = soraGroup.items.map(item => item.uniqueAspect);
      const uniqueAspects = [...new Set(aspects)];
      expect(uniqueAspects.length).toBe(aspects.length);
    });

    test('should categorize items correctly', async () => {
      const items: ParsedItem[] = [...mockSoraItems, mockDebateItem];
      const result = await groupingService.groupItems(items);
      
      const soraGroup = result.entityGroups[0];
      const categories = soraGroup.items.map(item => item.category);
      
      // Should have features and ethical categories
      expect(categories).toContain('features');
      expect(categories).toContain('ethical');
    });

    test('should handle items with different details separately', async () => {
      const items: ParsedItem[] = mockClaudeItems; // Different performance numbers
      const result = await groupingService.groupItems(items);
      
      const claudeGroup = result.entityGroups[0];
      
      // Both items should be preserved with their unique details
      expect(claudeGroup.totalItems).toBe(2);
      
      const summaries = claudeGroup.items.map(item => item.uniqueAspect);
      
      // Should contain different performance details
      const hasPerformanceDetails = summaries.some(summary => 
        summary.includes('20 prosentpoeng') || summary.includes('SweetBench') || summary.includes('overgår')
      );
      const hasCapabilityDetails = summaries.some(summary => 
        summary.includes('30 timer') || summary.includes('langvarige') || summary.includes('standard')
      );
      
      expect(hasPerformanceDetails).toBe(true);
      expect(hasCapabilityDetails).toBe(true);
    });
  });

  describe('Configuration and Edge Cases', () => {
    test('should not group items below minimum threshold', async () => {
      const serviceWith3Min = new SmartGroupingService({
        enabled: true,
        minGroupSize: 3,
        preserveDetails: true
      });
      
      const items: ParsedItem[] = mockSoraItems; // Only 2 items
      const result = await serviceWith3Min.groupItems(items);
      
      expect(result.entityGroups.length).toBe(0);
      expect(result.standaloneItems.length).toBe(2);
    });

    test('should handle disabled grouping', async () => {
      const disabledService = new SmartGroupingService({
        enabled: false,
        minGroupSize: 2,
        preserveDetails: true
      });
      
      const items: ParsedItem[] = [...mockSoraItems, ...mockClaudeItems];
      const result = await disabledService.groupItems(items);
      
      expect(result.entityGroups.length).toBe(0);
      expect(result.standaloneItems.length).toBe(items.length);
    });

    test('should generate accurate statistics', async () => {
      const items: ParsedItem[] = [...mockSoraItems, ...mockClaudeItems, standaloneItem];
      const result = await groupingService.groupItems(items);
      
      expect(result.stats.totalItems).toBe(5);
      expect(result.stats.groupedItems).toBe(4); // 2 Sora + 2 Claude
      expect(result.stats.standaloneItems).toBe(1);
      expect(result.stats.totalGroups).toBe(2);
      
      // Verify stats consistency
      expect(result.stats.groupedItems + result.stats.standaloneItems).toBe(result.stats.totalItems);
    });
  });
});

// Export test data for integration tests
export { mockSoraItems, mockClaudeItems, mockDebateItem, standaloneItem };
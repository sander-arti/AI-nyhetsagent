import { describe, test, beforeEach, expect } from 'vitest';
import { ContentClusteringService } from '../services/clustering.service.js';
import { NewsItem, DebateItem, DevItem } from '../types/schemas.js';

// Mock data for testing
const mockNewsItems: NewsItem[] = [
  {
    videoId: 'video1',
    channelId: 'channel1',
    sourceUrl: 'https://youtube.com/watch?v=video1',
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
    videoId: 'video2', 
    channelId: 'channel2',
    sourceUrl: 'https://youtube.com/watch?v=video2',
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
  },
  {
    videoId: 'video3',
    channelId: 'channel3', 
    sourceUrl: 'https://youtube.com/watch?v=video3',
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
    videoId: 'video4',
    channelId: 'channel4',
    sourceUrl: 'https://youtube.com/watch?v=video4', 
    timestamp: '00:15:20',
    confidence: 'high',
    rawContext: 'Claude Sonnet 4.5 kan tenke autonomt i over 30 timer',
    qualityScore: 0.9,
    relevance_score: 9,
    title: 'Claude Sonnet 4.5 setter ny standard for langvarige oppgaver',
    summary: 'AI-modeller som Claude Sonnet 4.5 kan utføre oppgaver i over 30 timer, en ny Moore\'s lov for AI-kapabiliteter.',
    entities: ['Claude', 'Sonnet 4.5'],
    type: 'research',
    impact: 'breaking'
  },
  {
    videoId: 'video5',
    channelId: 'channel5',
    sourceUrl: 'https://youtube.com/watch?v=video5',
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
  }
];

const mockDebateItems: DebateItem[] = [
  {
    videoId: 'debate1',
    channelId: 'debate_channel1',
    sourceUrl: 'https://youtube.com/watch?v=debate1',
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
  }
];

const mockDevItems: DevItem[] = [
  {
    videoId: 'dev1', 
    channelId: 'dev_channel1',
    sourceUrl: 'https://youtube.com/watch?v=dev1',
    timestamp: '00:18:30',
    confidence: 'high',
    rawContext: 'Claude Sonnet 4.5 forbedrer GitHub Copilot med betydelige forbedringer',
    qualityScore: 0.9,
    relevance_score: 8,
    title: 'Claude Sonnet 4.5 forbedrer GitHub Copilot',
    changeType: 'feature',
    whatChanged: 'GitHub Copilot får betydelige forbedringer i flertrinns resonnering og kodeforståelse med Claude Sonnet 4.5.',
    developerAction: 'try',
    codeExample: 'github.copilot.enable("claude-4.5")',
    links: [],
    affectedTechnologies: ['GitHub Copilot', 'Claude', 'VS Code'],
    difficulty: 'beginner'
  }
];

describe('ContentClusteringService', () => {
  let clusteringService: ContentClusteringService;

  beforeEach(() => {
    clusteringService = new ContentClusteringService({
      enabled: true,
      minClusterSize: 2,
      entityExtractionThreshold: 0.7,
      preserveAllDetails: true,
      generateSummaries: true,
      tldrConfig: {
        enabled: true,
        maxPoints: 5,
        includeStats: true
      }
    });
  });

  describe('Entity Extraction', () => {
    test('should extract main entities from mixed items', async () => {
      const allItems = [...mockNewsItems, ...mockDebateItems, ...mockDevItems];
      const result = await clusteringService.clusterItems(allItems);
      
      expect(result.clusters.length).toBeGreaterThan(0);
      
      // Should find Sora 2 cluster
      const soraCluster = result.clusters.find(c => 
        c.mainEntity.toLowerCase().includes('sora')
      );
      expect(soraCluster).toBeDefined();
      expect(soraCluster?.itemCount).toBeGreaterThanOrEqual(2);
      
      // Should find Claude cluster  
      const claudeCluster = result.clusters.find(c =>
        c.mainEntity.toLowerCase().includes('claude')
      );
      expect(claudeCluster).toBeDefined();
      expect(claudeCluster?.itemCount).toBeGreaterThanOrEqual(2);
    });

    test('should classify entity types correctly', async () => {
      const result = await clusteringService.clusterItems([...mockNewsItems]);
      
      const soraCluster = result.clusters.find(c => 
        c.mainEntity.toLowerCase().includes('sora')
      );
      expect(soraCluster?.entityType).toBe('product');
      
      const claudeCluster = result.clusters.find(c =>
        c.mainEntity.toLowerCase().includes('claude')  
      );
      expect(claudeCluster?.entityType).toBe('product');
    });
  });

  describe('Clustering Logic', () => {
    test('should group related items correctly', async () => {
      const result = await clusteringService.clusterItems([...mockNewsItems]);
      
      // Items about same entity should be clustered
      const clusters = result.clusters;
      expect(clusters.length).toBeGreaterThan(0);
      
      // Each cluster should have minimum required items
      clusters.forEach(cluster => {
        expect(cluster.itemCount).toBeGreaterThanOrEqual(2);
        expect(cluster.subTopics.length).toBeGreaterThan(0);
      });
    });

    test('should preserve all item details', async () => {
      const result = await clusteringService.clusterItems([...mockNewsItems]);
      
      // Check that original items are preserved (clustering may create sub-items for unique aspects)
      const originalItemCount = result.clusters.reduce((sum, cluster) => {
        return sum + cluster.subTopics.reduce((subSum, subTopic) => {
          return subSum + subTopic.items.filter(item => item.originalItem).length;
        }, 0);
      }, 0) + result.standaloneItems.length;
      
      expect(originalItemCount).toBeGreaterThanOrEqual(mockNewsItems.length);
      
      // Check that unique aspects are identified
      result.clusters.forEach(cluster => {
        cluster.subTopics.forEach(subTopic => {
          subTopic.items.forEach(item => {
            expect(item.uniqueAspects).toBeDefined();
            expect(item.sourceDetails).toBeDefined();
            expect(item.originalItem).toBeDefined();
          });
        });
      });
    });

    test('should handle mixed item types correctly', async () => {
      const allItems = [...mockNewsItems, ...mockDebateItems, ...mockDevItems];
      const result = await clusteringService.clusterItems(allItems);
      
      // Stats should track processed items (may be expanded due to unique aspects)
      expect(result.stats.totalItems).toBeGreaterThanOrEqual(allItems.length);
      expect(result.stats.clusteredItems + result.stats.standaloneItems).toBe(result.stats.totalItems);
    });
  });

  describe('Sub-topic Analysis', () => {
    test('should categorize items within clusters', async () => {
      const result = await clusteringService.clusterItems([...mockNewsItems, ...mockDebateItems]);
      
      const soraCluster = result.clusters.find(c => 
        c.mainEntity.toLowerCase().includes('sora')
      );
      
      if (soraCluster) {
        expect(soraCluster.subTopics.length).toBeGreaterThan(0);
        
        // Should have different categories for different aspects
        const categories = soraCluster.subTopics.map(st => st.category);
        expect(categories).toContain('features'); // Main Sora feature categories
        
        // If debate item about Sora exists, should have ethical category
        const hasEthicalCategory = categories.includes('ethical');
        const hasDebateAboutSora = mockDebateItems.some(item => 
          item.topic.toLowerCase().includes('sora')
        );
        if (hasDebateAboutSora) {
          expect(hasEthicalCategory).toBe(true);
        }
      }
    });

    test('should generate sub-topic summaries when enabled', async () => {
      const result = await clusteringService.clusterItems([...mockNewsItems]);
      
      result.clusters.forEach(cluster => {
        cluster.subTopics.forEach(subTopic => {
          if (subTopic.items.length > 1) {
            expect(subTopic.summary).toBeDefined();
            expect(typeof subTopic.summary).toBe('string');
            expect(subTopic.summary!.length).toBeGreaterThan(0);
          }
        });
      });
    });
  });

  describe('TL;DR Generation', () => {
    test('should generate TL;DR points when enabled', async () => {
      const result = await clusteringService.clusterItems([...mockNewsItems, ...mockDebateItems]);
      
      expect(result.tldr.length).toBeGreaterThan(0);
      expect(result.tldr.length).toBeLessThanOrEqual(5); // Max points configured
      
      result.tldr.forEach(point => {
        expect(point.summary).toBeDefined();
        expect(point.sourceCount).toBeGreaterThan(0);
        expect(point.relevanceScore).toBeGreaterThan(0);
        expect(['breaking', 'major', 'notable']).toContain(point.category);
      });
      
      // Should be sorted by relevance
      for (let i = 1; i < result.tldr.length; i++) {
        expect(result.tldr[i - 1].relevanceScore).toBeGreaterThanOrEqual(
          result.tldr[i].relevanceScore
        );
      }
    });
  });

  describe('Statistics', () => {
    test('should generate accurate statistics', async () => {
      const allItems = [...mockNewsItems, ...mockDebateItems, ...mockDevItems];
      const result = await clusteringService.clusterItems(allItems);
      
      // Stats track processed items (may include expanded unique aspects)
      expect(result.stats.totalItems).toBeGreaterThanOrEqual(allItems.length);
      expect(result.stats.clusteredItems + result.stats.standaloneItems).toBe(result.stats.totalItems);
      expect(result.stats.totalClusters).toBe(result.clusters.length);
      expect(result.stats.processingTimeMs).toBeGreaterThan(0);
      
      if (result.clusters.length > 0) {
        expect(result.stats.largestClusterSize).toBeGreaterThan(0);
        expect(result.stats.averageClusterSize).toBeGreaterThan(0);
      }
    });
  });

  describe('Configuration', () => {
    test('should respect minimum cluster size setting', async () => {
      const serviceWithLargerMinSize = new ContentClusteringService({
        enabled: true,
        minClusterSize: 3, // Require 3+ items per cluster
        entityExtractionThreshold: 0.7,
        preserveAllDetails: true,
        generateSummaries: true,
        tldrConfig: { enabled: true, maxPoints: 5, includeStats: true }
      });
      
      const result = await serviceWithLargerMinSize.clusterItems([...mockNewsItems]);
      
      // With higher threshold, should have fewer/no clusters
      result.clusters.forEach(cluster => {
        expect(cluster.itemCount).toBeGreaterThanOrEqual(3);
      });
    });

    test('should handle disabled clustering', async () => {
      const disabledService = new ContentClusteringService({
        enabled: false,
        minClusterSize: 2,
        entityExtractionThreshold: 0.7,
        preserveAllDetails: true,
        generateSummaries: true,
        tldrConfig: { enabled: false, maxPoints: 5, includeStats: true }
      });
      
      const result = await disabledService.clusterItems([...mockNewsItems]);
      
      expect(result.clusters.length).toBe(0);
      expect(result.standaloneItems.length).toBe(mockNewsItems.length);
      expect(result.tldr.length).toBe(0);
    });
  });
});

// Export for potential integration tests
export { mockNewsItems, mockDebateItems, mockDevItems };
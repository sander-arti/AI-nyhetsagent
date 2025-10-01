#!/usr/bin/env tsx

import { SlackService } from '../src/services/slack.service.js';
import { getDatabase } from '../src/db/database.js';
import type { NewsItem, DebateItem, DevItem } from '../src/types/schemas.js';

async function testSlackPost() {
  console.log('🧪 Testing Slack posting with mock data...');
  
  try {
    // Use actual processed items from database for consistency
    const newsItems: NewsItem[] = [
      {
        type: 'release',
        title: 'OpenAI Launches ChatGPT Pulse',
        summary: 'OpenAI har lansert ChatGPT Pulse, en proaktiv bakgrunnsagent som gir personaliserte innsikter basert på brukerinteraksjoner. Dette markerer et betydelig skifte mot proaktiv AI-engasjement.',
        entities: ['OpenAI', 'ChatGPT', 'Pulse'],
        timestamp: '2024-09-29T08:00:00Z',
        confidence: 'high',
        videoId: 'YZwDJBup4Rc',
        channelId: 'UCKelCK4ZaO6HeEI1KQjqzWA',
        sourceUrl: 'https://youtube.com/watch?v=YZwDJBup4Rc',
        rawContext: 'Original text from transcript',
        relevance_score: 9,
        qualityScore: 0.95
      },
      {
        type: 'policy', 
        title: 'Pro Features for ChatGPT Pulse',
        summary: 'Noen funksjoner i ChatGPT Pulse vil først være tilgjengelig kun for pro-abonnenter, med ekstra gebyrer for nye produkter mens OpenAI sikter på å redusere intelligenskostnader.',
        entities: ['OpenAI', 'ChatGPT', 'Pulse', 'Pro'],
        timestamp: '2024-09-29T08:15:00Z',
        confidence: 'high',
        videoId: 'YZwDJBup4Rc', 
        channelId: 'UCKelCK4ZaO6HeEI1KQjqzWA',
        sourceUrl: 'https://youtube.com/watch?v=YZwDJBup4Rc',
        rawContext: 'Original text from transcript',
        relevance_score: 7,
        qualityScore: 0.85
      },
      {
        type: 'tool',
        title: 'GitHub Copilot får Multi-Repo Support',
        summary: 'GitHub Copilot får støtte for å analysere kode på tvers av flere repositories samtidig, noe som forbedrer kontekst-awareness betydelig.',
        entities: ['GitHub', 'Copilot'],
        timestamp: '2024-09-29T08:30:00Z',
        confidence: 'medium',
        videoId: 'YZwDJBup4Rc',
        channelId: 'UCKelCK4ZaO6HeEI1KQjqzWA', 
        sourceUrl: 'https://youtube.com/watch?v=YZwDJBup4Rc',
        rawContext: 'Original text from transcript',
        relevance_score: 8,
        qualityScore: 0.88
      },
      {
        type: 'research',
        title: 'Ny studie om AI-hallusinasjoner',
        summary: 'Forskere ved Stanford fant at hallusinasjonsraten kan reduseres med 40% ved bruk av retrieval-augmented generation.',
        entities: ['Stanford'],
        timestamp: '2024-09-29T08:45:00Z',
        confidence: 'medium',
        videoId: 'YZwDJBup4Rc',
        channelId: 'UCKelCK4ZaO6HeEI1KQjqzWA',
        sourceUrl: 'https://youtube.com/watch?v=YZwDJBup4Rc',
        rawContext: 'Original text from transcript',
        relevance_score: 6,
        qualityScore: 0.68
      },
      {
        type: 'other',
        title: 'OpenAI CEO kommenterer konkurranse',
        summary: 'Sam Altman snakket generelt om AI-konkurranse i et intervju, uten spesifikke detaljer eller kunngjøringer.',
        entities: ['OpenAI', 'Sam Altman'],
        timestamp: '2024-09-29T09:00:00Z',
        confidence: 'low',
        videoId: 'YZwDJBup4Rc',
        channelId: 'UCKelCK4ZaO6HeEI1KQjqzWA',
        sourceUrl: 'https://youtube.com/watch?v=YZwDJBup4Rc',
        rawContext: 'Original text from transcript',
        relevance_score: 3,
        qualityScore: 0.38
      },
      // Adding more items to test block splitting
      {
        type: 'tool',
        title: 'Anthropic Claude 3.5 Sonnet Pro lanseres',
        summary: 'Anthropic lanserer Claude 3.5 Sonnet Pro med 2x raskere responstid og 4x større kontekstvindu på 200K tokens.',
        entities: ['Anthropic', 'Claude'],
        timestamp: '2024-09-29T09:15:00Z',
        confidence: 'high',
        videoId: 'YZwDJBup4Rc',
        channelId: 'UCKelCK4ZaO6HeEI1KQjqzWA',
        sourceUrl: 'https://youtube.com/watch?v=YZwDJBup4Rc',
        rawContext: 'Original text from transcript',
        relevance_score: 9,
        qualityScore: 0.98
      },
      {
        type: 'release',
        title: 'Google Gemini Ultra får multimodal capabilities',
        summary: 'Google oppgraderer Gemini Ultra med støtte for video-analyse, 3D-objektgjenkjenning og real-time bildeforståelse.',
        entities: ['Google', 'Gemini'],
        timestamp: '2024-09-29T09:30:00Z',
        confidence: 'high',
        videoId: 'YZwDJBup4Rc',
        channelId: 'UCKelCK4ZaO6HeEI1KQjqzWA',
        sourceUrl: 'https://youtube.com/watch?v=YZwDJBup4Rc',
        rawContext: 'Original text from transcript',
        relevance_score: 8,
        qualityScore: 0.92
      },
      {
        type: 'funding',
        title: 'AI startup Cohere får $450M Series D',
        summary: 'Cohere samler inn $450 millioner i Series D-runde ledet av PSP Investments med deltakelse fra NVIDIA og Oracle.',
        entities: ['Cohere', 'PSP Investments', 'NVIDIA', 'Oracle'],
        timestamp: '2024-09-29T09:45:00Z',
        confidence: 'high',
        videoId: 'YZwDJBup4Rc',
        channelId: 'UCKelCK4ZaO6HeEI1KQjqzWA',
        sourceUrl: 'https://youtube.com/watch?v=YZwDJBup4Rc',
        rawContext: 'Original text from transcript',
        relevance_score: 7,
        qualityScore: 0.83
      },
      {
        type: 'research',
        title: 'MIT presenterer breakthrough i quantum-enhanced AI',
        summary: 'MIT-forskere demonstrerer quantum-classical hybrid system som oppnår 10x speedup for visse ML-algoritmer.',
        entities: ['MIT'],
        timestamp: '2024-09-29T10:00:00Z',
        confidence: 'medium',
        videoId: 'YZwDJBup4Rc',
        channelId: 'UCKelCK4ZaO6HeEI1KQjqzWA',
        sourceUrl: 'https://youtube.com/watch?v=YZwDJBup4Rc',
        rawContext: 'Original text from transcript',
        relevance_score: 6,
        qualityScore: 0.71
      },
      {
        type: 'policy',
        title: 'EU AI Act Phase 2 implementering starter',
        summary: 'Europeiske selskaper må nå implementere AI Act compliance for høy-risiko AI-systemer innen Q2 2025.',
        entities: ['EU'],
        timestamp: '2024-09-29T10:15:00Z',
        confidence: 'high',
        videoId: 'YZwDJBup4Rc',
        channelId: 'UCKelCK4ZaO6HeEI1KQjqzWA',
        sourceUrl: 'https://youtube.com/watch?v=YZwDJBup4Rc',
        rawContext: 'Original text from transcript',
        relevance_score: 7,
        qualityScore: 0.85
      },
      {
        type: 'other',
        title: 'Tech-giganter diskuterer AI-sikkerhet på toppmøte',
        summary: 'CEO-er fra store tech-selskaper møttes for å diskutere felles standarder for AI-sikkerhet og etikk.',
        entities: [],
        timestamp: '2024-09-29T10:30:00Z',
        confidence: 'low',
        videoId: 'YZwDJBup4Rc',
        channelId: 'UCKelCK4ZaO6HeEI1KQjqzWA',
        sourceUrl: 'https://youtube.com/watch?v=YZwDJBup4Rc',
        rawContext: 'Original text from transcript',
        relevance_score: 4,
        qualityScore: 0.42
      }
    ];
    
    const debateItems: DebateItem[] = [
      {
        type: 'debate',
        topic: 'H-1B visa-program og teknologiarbeidskraft',
        whatWasDiscussed: 'Jason Calacanis diskuterte H-1B visa-systemet og dets påvirkning på amerikansk tech-industri. Han argumenterte for at deler av programmet har blitt misbrukt og ikke fungerer som tiltenkt for å tiltrekke topptalent.',
        positions: {
          pro: ['H-1B bringer verdifull internasjonal talent til USA', 'Teknologiselskaper trenger tilgang til globale eksperter', 'Bidrar til innovasjon og konkurranse'],
          contra: ['Halvparten av H-1B-søknadene er "et gigantisk svindel"', 'Undergraver lønn for amerikanske teknologiarbeidere', 'Systemet favoriserer konsulentfirmaer over innovasjon']
        },
        implications: 'Debatt om H-1B-reform kan påvirke hvordan teknologiselskaper rekrutterer talent og kan endre konkurransebildet i amerikansk tech-industri.',
        recommendedDeepDive: true,
        timestamp: '2024-09-29T08:15:00Z',
        confidence: 'medium',
        videoId: 'uYAcQTrAErw',
        channelId: 'UCESLZhusAkFfsNsApnjF_Cg',
        sourceUrl: 'https://youtube.com/watch?v=uYAcQTrAErw'
      }
    ];
    
    const devItems: DevItem[] = [
      {
        title: 'ChatGPT blir 100x mer agentisk med nye oppdateringer',
        whatChanged: 'David Ondrej viser hvordan ChatGPT har blitt betydelig mer kapabel som autonom agent med nye reasoning-funksjoner og proaktive capabilities. Demonstrerer praktiske brukscase for utviklere som vil bygge AI-drevne applikasjoner.',
        changeType: 'feature',
        developerAction: 'try',
        timestamp: '2024-09-29T08:30:00Z',
        confidence: 'high',
        videoId: 'oowzvdpH_2o',
        channelId: 'UCPGrgwfbkjTIgPoOh2q1BAg',
        sourceUrl: 'https://youtube.com/watch?v=oowzvdpH_2o'
      },
      {
        title: 'Scrape tusenvis av ressurser med kun AI-prompts',
        whatChanged: 'Jordan Urbs viser hvordan man kan bygge omfattende katalog-directories ved å bruke kun AI-prompts for web scraping. Inkluderer templates og verktøy for å automatisere datainnsamling fra multiple kilder uten tradisjonell koding.',
        changeType: 'tool',
        developerAction: 'try', 
        timestamp: '2024-09-29T09:00:00Z',
        confidence: 'high',
        videoId: 'Swl2fXEIQzs',
        channelId: 'UCJpdOdMVkatTJ2Ue_tLqMpA',
        sourceUrl: 'https://youtube.com/watch?v=Swl2fXEIQzs'
      }
    ];
    
    console.log(`📝 Using mock data: ${newsItems.length} news, ${debateItems.length} debate, ${devItems.length} dev items`);
    console.log('🎯 News items with relevance scores:');
    newsItems.forEach((item, i) => {
      console.log(`   ${i+1}. "${item.title}" (relevance: ${item.relevance_score})`);
    });
    
    // Count items that will be shown (relevance >= 5)
    const relevantNews = newsItems.filter(item => item.relevance_score >= 5);
    console.log(`📊 ${relevantNews.length}/${newsItems.length} news items will be shown (relevance >= 5)`);
    
    // Create brief data
    const briefData = {
      newsItems,
      debateItems, 
      devItems,
      runId: `test_${Date.now()}`,
      generatedAt: new Date(),
      stats: {
        totalVideos: 5,
        totalItems: 5,
        processingTimeMs: 120000,
        cost: 0.25
      }
    };
    
    // Initialize Slack service
    const slackService = new SlackService(process.env.SLACK_BOT_TOKEN!);
    
    // Post to Slack
    console.log('📤 Posting to Slack...');
    const result = await slackService.sendBrief(briefData, process.env.SLACK_CHANNEL_ID!);
    
    if (result.success) {
      console.log('✅ Slack post successful!');
      console.log(`📍 Channel: ${result.channelId}`);
      console.log(`🕒 Timestamp: ${result.timestamp}`);
    } else {
      console.log('❌ Slack post failed:', result.error);
      process.exit(1);
    }
    
    console.log('🎉 Slack test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testSlackPost();
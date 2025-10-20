import { DedupProcessor } from '../src/processors/dedup.processor.js';
import { NewsItem } from '../src/types/schemas.js';
import 'dotenv/config';

async function testContextAwareDedup() {
  console.log('🧪 Testing Context-Aware Deduplication');
  console.log('='.repeat(70));
  console.log('');

  const dedup = new DedupProcessor(process.env.OPENAI_API_KEY!);

  // Test Scenario 1: Same news from 3 sources within 24h
  console.log('📰 Test 1: Breaking News from Multiple Sources (24h window)');
  console.log('-'.repeat(70));

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const breakingNews: NewsItem[] = [
    {
      title: 'OpenAI Launches GPT-5 with Revolutionary Capabilities',
      summary: 'OpenAI announced GPT-5 today, featuring significant improvements in reasoning and multimodal understanding.',
      entities: ['OpenAI', 'GPT-5', 'Sam Altman'],
      confidence: 'high',
      relevance: 9,
      rawContext: 'Full context from TechCrunch article about GPT-5 launch...',
      channelId: 'techcrunch',
      channelName: 'TechCrunch',
      videoId: 'video1',
      publishedAt: twoHoursAgo.toISOString() as any,
    },
    {
      title: 'GPT-5 Released by OpenAI: Game-Changing AI Model',
      summary: 'OpenAI has released GPT-5, their most advanced AI model yet, with breakthrough reasoning capabilities.',
      entities: ['OpenAI', 'GPT-5'],
      confidence: 'high',
      relevance: 9,
      rawContext: 'Full context from The Verge article about GPT-5...',
      channelId: 'theverge',
      channelName: 'The Verge',
      videoId: 'video2',
      publishedAt: oneHourAgo.toISOString() as any,
    },
    {
      title: 'OpenAI Unveils GPT-5 with Enhanced Reasoning',
      summary: 'In a surprise announcement, OpenAI revealed GPT-5, promising major advances in AI reasoning and understanding.',
      entities: ['OpenAI', 'GPT-5', 'Sam Altman'],
      confidence: 'very_high',
      relevance: 10,
      rawContext: 'Full context from Wired magazine exclusive on GPT-5 launch...',
      channelId: 'wired',
      channelName: 'Wired',
      videoId: 'video3',
      publishedAt: now.toISOString() as any,
    },
  ];

  console.log(`Testing ${breakingNews.length} news items about the same story...`);
  console.log('');

  // Test Scenario 2: Follow-up article 3 days later
  console.log('📰 Test 2: Follow-Up Article (3 days later)');
  console.log('-'.repeat(70));

  const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const followUp: NewsItem = {
    title: 'GPT-5 Adoption Soars: 1 Million Users in First Week',
    summary: 'OpenAI reports that GPT-5 has reached 1 million users in just one week, setting a new record for AI adoption.',
    entities: ['OpenAI', 'GPT-5'],
    confidence: 'high',
    relevance: 8,
    rawContext: 'Follow-up report on GPT-5 adoption metrics...',
    channelId: 'techcrunch',
    channelName: 'TechCrunch',
    videoId: 'video4',
    publishedAt: threeDaysLater.toISOString() as any,
  };

  console.log('Testing follow-up article temporal detection...');
  console.log('');

  // Test Scenario 3: Analysis piece 2 weeks later
  console.log('📰 Test 3: Analysis Piece (2 weeks later)');
  console.log('-'.repeat(70));

  const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const analysis: NewsItem = {
    title: 'How GPT-5 Will Transform Enterprise AI: An In-Depth Analysis',
    summary: 'Industry experts weigh in on the long-term implications of GPT-5 for enterprise AI adoption and transformation.',
    entities: ['OpenAI', 'GPT-5', 'Enterprise AI'],
    confidence: 'high',
    relevance: 7,
    rawContext: 'Detailed analysis piece examining GPT-5 impact...',
    channelId: 'hbr',
    channelName: 'Harvard Business Review',
    videoId: 'video5',
    publishedAt: twoWeeksLater.toISOString() as any,
  };

  console.log('Testing analysis piece temporal detection...');
  console.log('');

  // Test Scenario 4: Completely different news
  console.log('📰 Test 4: Completely Different News');
  console.log('-'.repeat(70));

  const differentNews: NewsItem = {
    title: 'Google Announces Quantum Computing Breakthrough',
    summary: 'Google researchers have achieved a major milestone in quantum computing error correction.',
    entities: ['Google', 'Quantum Computing'],
    confidence: 'high',
    relevance: 9,
    rawContext: 'Quantum computing breakthrough announcement...',
    channelId: 'nature',
    channelName: 'Nature',
    videoId: 'video6',
    publishedAt: now.toISOString() as any,
  };

  console.log('Testing unrelated news item...');
  console.log('');

  // Combine all items
  const allItems = [...breakingNews, followUp, analysis, differentNews];

  console.log('📊 Summary');
  console.log('='.repeat(70));
  console.log(`Total items to deduplicate: ${allItems.length}`);
  console.log('');
  console.log('Expected behavior:');
  console.log('- Breaking news (3 items) → Should cluster into 1 with best source as canonical');
  console.log('- Follow-up (1 item) → Might cluster with breaking or separate based on threshold');
  console.log('- Analysis (1 item) → Separate cluster (different time window)');
  console.log('- Different news (1 item) → Completely separate cluster');
  console.log('');

  // Note: Actual deduplication requires ChromaDB running
  console.log('⚠️ Note: Full deduplication requires ChromaDB server running.');
  console.log('This test demonstrates the input structure for context-aware dedup.');
  console.log('');

  // Demonstrate temporal context detection
  console.log('🕐 Temporal Context Analysis');
  console.log('-'.repeat(70));

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    const pubDate = new Date(item.publishedAt as any);
    const ageHours = (now.getTime() - pubDate.getTime()) / (1000 * 60 * 60);

    let phase = 'breaking';
    if (ageHours > 24 && ageHours <= 7 * 24) {
      phase = 'follow-up';
    } else if (ageHours > 7 * 24) {
      phase = 'analysis';
    }

    console.log(`Item ${i + 1}: ${item.title.substring(0, 50)}...`);
    console.log(`   Age: ${Math.abs(ageHours).toFixed(1)}h | Phase: ${phase}`);
    console.log(`   Source: ${item.channelName} | Confidence: ${item.confidence}`);
    console.log('');
  }

  console.log('✨ Test completed!');
  console.log('');
  console.log('To run actual deduplication:');
  console.log('1. Start ChromaDB: docker run -p 8000:8000 chromadb/chroma');
  console.log('2. Run pipeline with context-aware dedup enabled');

  await dedup.cleanup();
}

testContextAwareDedup().catch(console.error);

import { getDatabase } from '../src/db/database.js';
import { LLMService } from '../src/services/llm.service.js';

async function testRealVideo() {
  const db = getDatabase();
  const llm = new LLMService();

  // Get a video with transcript
  const videoId = '100DDD6F92332E777781DC92500CC699'; // "Anthropic's New Claude Skills Could Be A Really Big Deal"

  console.log('🎬 Testing semantic chunking on real video...\n');

  const videoRows = await db.query(
    'SELECT * FROM videos WHERE id = ?',
    [videoId]
  );

  if (videoRows.length === 0) {
    console.error('❌ Video not found');
    return;
  }

  const video = videoRows[0];
  console.log(`📹 Video: ${video.title}`);
  console.log(`⏱️ Duration: ${(video.duration_seconds / 60).toFixed(1)} minutes\n`);

  const transcriptRows = await db.query(
    'SELECT * FROM transcripts WHERE video_id = ?',
    [videoId]
  );

  if (transcriptRows.length === 0) {
    console.error('❌ Transcript not found');
    return;
  }

  const transcriptData = transcriptRows[0];
  const transcript = {
    text: transcriptData.text,
    segments: transcriptData.segments ? JSON.parse(transcriptData.segments) : null,
    language: transcriptData.language
  };

  console.log(`📝 Transcript: ${transcript.text.length} characters`);
  console.log(`🔤 Segments: ${transcript.segments?.length || 0}\n`);

  // Parse with semantic chunking
  console.log('🧠 Parsing with semantic chunking...');
  const startTime = Date.now();

  const parseRequest = {
    transcript,
    sourceType: 'news' as const,
    videoMetadata: {
      title: video.title,
      channelName: 'Test',
      duration: video.duration_seconds,
      publishedAt: new Date(video.published_at)
    }
  };

  const result = await llm.parseTranscript(parseRequest);

  const duration = Date.now() - startTime;

  console.log(`\n✅ Parsing complete in ${(duration / 1000).toFixed(1)}s\n`);
  console.log(`📊 Results:`);
  console.log(`   Total items: ${result.totalItems}`);
  console.log(`   Valid items: ${result.validItems || 0}`);
  console.log(`   Items array length: ${result.items?.length || 0}`);
  console.log(`   Cost: $${(result.cost || 0).toFixed(4)}`);
  console.log(`   Processing time: ${result.processingTimeMs || 0}ms\n`);

  // Show all items (both valid and invalid for debugging)
  const allItems = result.items || [];
  if (allItems.length > 0) {
    console.log(`\n📋 Extracted Items:\n`);
    result.items.forEach((item: any, i: number) => {
      console.log(`${i + 1}. ${item.title}`);
      console.log(`   Confidence: ${item.confidence || 'unknown'}`);
      console.log(`   Relevance: ${item.relevance || 'N/A'}/10`);
      if (item.entities && item.entities.length > 0) {
        console.log(`   Entities: ${item.entities.join(', ')}`);
      }
      console.log('');
    });
  } else {
    console.log('\n📋 No items extracted');
  }

  await db.close();
}

testRealVideo().catch(console.error);

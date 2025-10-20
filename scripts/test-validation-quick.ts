/**
 * Quick test of validation fixes
 */

import { getDatabase } from '../src/db/database.js';
import { LLMService } from '../src/services/llm.service.js';

async function testValidationFixes() {
  const db = getDatabase();

  console.log('🧪 Quick Validation Test\n');

  // Fetch ONE recent transcribed video
  const videoRows = await db.query(`
    SELECT v.*, t.text, t.segments, v.language
    FROM videos v
    JOIN transcripts t ON v.id = t.video_id
    WHERE v.published_at >= datetime('now', '-72 hours')
    ORDER BY v.published_at DESC
    LIMIT 1
  `);

  if (videoRows.length === 0) {
    console.log('❌ No transcribed videos found');
    await db.close();
    return;
  }

  const video = videoRows[0];
  console.log(`📹 Testing: ${video.title}`);
  console.log(`⏱️  Duration: ${(video.duration_seconds / 60).toFixed(1)} min\n`);

  const transcript = {
    videoId: video.id,
    text: video.text,
    segments: video.segments ? JSON.parse(video.segments) : [],
    language: video.language || 'en',
  };

  const parseRequest = {
    transcript,
    sourceType: 'news' as const,
    videoMetadata: {
      title: video.title,
      channelName: 'Test',
      duration: video.duration_seconds,
      publishedAt: new Date(video.published_at),
    },
  };

  // Test with validation fixes
  const llm = new LLMService(process.env.OPENAI_API_KEY!);
  llm.setMultiPass(false);
  llm.setConsensus(false);

  console.log('🔬 Running extraction with adaptive validation...\n');

  const result = await llm.parseTranscript(parseRequest);

  console.log('\n\n✅ RESULTS:');
  console.log(`   Items extracted: ${result.totalItems}`);
  console.log(`   Cost: $${(result.estimatedCost || 0).toFixed(4)}`);
  console.log(`   Time: ${(result.processingTimeMs / 1000).toFixed(1)}s`);

  if (result.totalItems > 0) {
    console.log('\n📄 Sample item:');
    console.log(JSON.stringify(result.productReleases?.[0] || result.toolUpdates?.[0] || {}, null, 2).substring(0, 500));
  }

  await db.close();
}

testValidationFixes().catch(console.error);

import { getDatabase } from '../src/db/database.js';
import { LLMService } from '../src/services/llm.service.js';

async function testMultiPass() {
  const db = getDatabase();
  const llm = new LLMService(process.env.OPENAI_API_KEY!);

  const videoId = '100DDD6F92332E777781DC92500CC699'; // Anthropic Claude Skills video

  console.log('🧪 Testing Multi-Pass Extraction');
  console.log('='.repeat(70));
  console.log('');

  // Get video and transcript
  const videoRows = await db.query('SELECT * FROM videos WHERE id = ?', [videoId]);
  const transcriptRows = await db.query('SELECT * FROM transcripts WHERE video_id = ?', [videoId]);

  if (videoRows.length === 0 || transcriptRows.length === 0) {
    console.error('❌ Video or transcript not found');
    await db.close();
    return;
  }

  const video = videoRows[0];
  const transcriptData = transcriptRows[0];
  const transcript = {
    text: transcriptData.text,
    segments: transcriptData.segments ? JSON.parse(transcriptData.segments) : null,
    language: transcriptData.language,
    videoId: video.id
  };

  console.log(`📹 Video: ${video.title}`);
  console.log(`⏱️ Duration: ${(video.duration_seconds / 60).toFixed(1)} minutes`);
  console.log('');

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

  // Test 1: Single-pass (baseline)
  console.log('🔵 Test 1: Single-Pass Extraction');
  console.log('-'.repeat(70));
  llm.setMultiPass(false);
  llm.resetUsage();
  const singlePassStart = Date.now();
  const singlePassResult = await llm.parseTranscript(parseRequest);
  const singlePassTime = Date.now() - singlePassStart;

  console.log(`✅ Items extracted: ${singlePassResult.totalItems}`);
  console.log(`💰 Cost: $${(singlePassResult.estimatedCost || 0).toFixed(4)}`);
  console.log(`⏱️ Time: ${(singlePassTime / 1000).toFixed(1)}s`);
  console.log('');

  // Test 2: Multi-pass
  console.log('🟢 Test 2: Multi-Pass Extraction');
  console.log('-'.repeat(70));
  llm.setMultiPass(true);
  llm.resetUsage();
  const multiPassStart = Date.now();
  const multiPassResult = await llm.parseTranscript(parseRequest);
  const multiPassTime = Date.now() - multiPassStart;

  console.log(`✅ Items extracted: ${multiPassResult.totalItems}`);
  if (multiPassResult.multiPassMetrics) {
    console.log(`   📊 Pass 1: ${multiPassResult.multiPassMetrics.pass1Items} items`);
    console.log(`   📊 Pass 2: +${multiPassResult.multiPassMetrics.pass2Items} items`);
    console.log(`   📊 Pass 3: ${multiPassResult.multiPassMetrics.pass3Improvements} improvements`);
    if (multiPassResult.multiPassMetrics.skippedPasses.length > 0) {
      console.log(`   ⏭️ Skipped: ${multiPassResult.multiPassMetrics.skippedPasses.join(', ')}`);
    }
  }
  console.log(`💰 Cost: $${(multiPassResult.estimatedCost || 0).toFixed(4)}`);
  console.log(`⏱️ Time: ${(multiPassTime / 1000).toFixed(1)}s`);
  console.log('');

  // Comparison
  console.log('📊 Comparison: Multi-Pass vs Single-Pass');
  console.log('='.repeat(70));

  const itemsDiff = multiPassResult.totalItems - singlePassResult.totalItems;
  const itemsPercent = singlePassResult.totalItems > 0
    ? ((itemsDiff / singlePassResult.totalItems) * 100).toFixed(1)
    : '0.0';

  const costIncrease = ((multiPassResult.estimatedCost || 0) - (singlePassResult.estimatedCost || 0)) / (singlePassResult.estimatedCost || 1) * 100;
  const timeIncrease = ((multiPassTime - singlePassTime) / singlePassTime) * 100;

  console.log('');
  console.log(`📈 Items extracted:`);
  console.log(`   Single-pass: ${singlePassResult.totalItems}`);
  console.log(`   Multi-pass:  ${multiPassResult.totalItems}`);
  console.log(`   Difference:  ${itemsDiff > 0 ? '+' : ''}${itemsDiff} (${itemsPercent > '0' ? '+' : ''}${itemsPercent}%)`);
  console.log('');
  console.log(`💸 Cost:`);
  console.log(`   Single-pass: $${(singlePassResult.estimatedCost || 0).toFixed(4)}`);
  console.log(`   Multi-pass:  $${(multiPassResult.estimatedCost || 0).toFixed(4)}`);
  console.log(`   Increase:    +${costIncrease.toFixed(1)}%`);
  console.log('');
  console.log(`⏱️ Processing time:`);
  console.log(`   Single-pass: ${(singlePassTime / 1000).toFixed(1)}s`);
  console.log(`   Multi-pass:  ${(multiPassTime / 1000).toFixed(1)}s`);
  console.log(`   Increase:    +${timeIncrease.toFixed(1)}%`);
  console.log('');

  // Quality assessment
  console.log('✨ Quality Assessment');
  console.log('-'.repeat(70));

  if (multiPassResult.multiPassMetrics) {
    const totalPass2Items = multiPassResult.multiPassMetrics.pass2Items;
    const totalImprovements = multiPassResult.multiPassMetrics.pass3Improvements;

    console.log(`✅ Pass 2 found ${totalPass2Items} additional items that were missed`);
    console.log(`✅ Pass 3 made ${totalImprovements} improvements (merges, enhancements)`);

    if (itemsDiff > 0) {
      console.log(`✅ Net gain: ${itemsDiff} more items with multi-pass`);
    } else if (itemsDiff < 0) {
      console.log(`✅ Quality over quantity: ${Math.abs(itemsDiff)} duplicates merged`);
    } else {
      console.log(`➡️ Same item count, but quality improved through refinement`);
    }
  }

  console.log('');
  console.log('🎯 Recommendation:');
  if (itemsDiff >= 2 || (multiPassResult.multiPassMetrics?.pass3Improvements || 0) >= 3) {
    console.log('   ✅ Multi-pass shows significant improvement!');
    console.log('   💡 Consider enabling for high-value content');
  } else if (costIncrease > 100) {
    console.log('   ⚠️ Multi-pass has high cost increase for modest gains');
    console.log('   💡 Use selectively for important videos only');
  } else {
    console.log('   ➡️ Results are similar. Evaluate based on cost/time constraints');
  }

  console.log('');
  console.log('✨ Test completed!');

  await db.close();
}

testMultiPass().catch(console.error);

/**
 * Test Multi-Model Consensus on Recent Videos (24h)
 *
 * Simulates consensus validation on videos published in the last 24 hours
 */

import { getDatabase } from '../src/db/database.js';
import { LLMService } from '../src/services/llm.service.js';

async function testConsensus24h() {
  const db = getDatabase();

  console.log('🤝 Testing Multi-Model Consensus on 24h Videos\n');
  console.log('='.repeat(80));

  // Fetch videos from last 24 hours with transcripts
  const videoRows = await db.query(`
    SELECT v.*, t.text, t.segments, v.language
    FROM videos v
    JOIN transcripts t ON v.id = t.video_id
    WHERE v.published_at >= datetime('now', '-24 hours')
    ORDER BY v.published_at DESC
    LIMIT 3
  `);

  if (videoRows.length === 0) {
    console.log('❌ No transcribed videos found from last 24 hours');
    console.log('ℹ️  Run the transcription pipeline first to generate transcripts\n');
    await db.close();
    return;
  }

  console.log(`\n📹 Found ${videoRows.length} transcribed video(s) from last 24h\n`);

  // Results aggregation
  const results = {
    singleModel: { totalItems: 0, totalCost: 0, totalTime: 0 },
    hierarchical: { totalItems: 0, totalCost: 0, totalTime: 0 },
    ensemble: { totalItems: 0, totalCost: 0, totalTime: 0 },
  };

  for (let i = 0; i < videoRows.length; i++) {
    const video = videoRows[i];

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📹 Video ${i + 1}/${videoRows.length}: ${video.title}`);
    console.log(`⏱️  Duration: ${(video.duration_seconds / 60).toFixed(1)} min`);
    console.log(`📅 Published: ${new Date(video.published_at).toLocaleString()}`);
    console.log(`${'='.repeat(80)}\n`);

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
        channelName: 'Test Channel',
        duration: video.duration_seconds,
        publishedAt: new Date(video.published_at),
      },
    };

    // Test 1: Single Model (Baseline)
    console.log('📊 Test 1: Single Model (Baseline)');
    console.log('-'.repeat(40));

    const llm1 = new LLMService(process.env.OPENAI_API_KEY!);
    llm1.setMultiPass(false);
    llm1.setConsensus(false);

    try {
      const singleStart = Date.now();
      const singleResult = await llm1.parseTranscript(parseRequest);
      const singleTime = Date.now() - singleStart;

      console.log(`✅ Items: ${singleResult.totalItems}`);
      console.log(`💰 Cost: $${(singleResult.estimatedCost || 0).toFixed(4)}`);
      console.log(`⏱️  Time: ${(singleTime / 1000).toFixed(1)}s\n`);

      results.singleModel.totalItems += singleResult.totalItems;
      results.singleModel.totalCost += singleResult.estimatedCost || 0;
      results.singleModel.totalTime += singleTime;
    } catch (error) {
      console.error('❌ Single model failed:', error);
    }

    // Test 2: Hierarchical Consensus
    console.log('📊 Test 2: Hierarchical Consensus');
    console.log('-'.repeat(40));

    // Check if ANTHROPIC_API_KEY is available
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('⚠️  ANTHROPIC_API_KEY not set, skipping hierarchical consensus');
      console.log('ℹ️  Set ANTHROPIC_API_KEY to test hierarchical consensus\n');
    } else {
      const llm2 = new LLMService(process.env.OPENAI_API_KEY!, {
        anthropic: process.env.ANTHROPIC_API_KEY,
      });
      llm2.setMultiPass(false);
      llm2.setConsensus(true);

      try {
        const hierStart = Date.now();
        const hierResult = await llm2.parseTranscript(parseRequest);
        const hierTime = Date.now() - hierStart;

        console.log(`✅ Items: ${hierResult.totalItems}`);
        console.log(`💰 Cost: $${(hierResult.estimatedCost || 0).toFixed(4)}`);
        console.log(`⏱️  Time: ${(hierTime / 1000).toFixed(1)}s\n`);

        results.hierarchical.totalItems += hierResult.totalItems;
        results.hierarchical.totalCost += hierResult.estimatedCost || 0;
        results.hierarchical.totalTime += hierTime;
      } catch (error) {
        console.error('❌ Hierarchical consensus failed:', error);
      }
    }

    // Test 3: Ensemble (only if we have time and budget)
    if (videoRows.length === 1 && process.env.ANTHROPIC_API_KEY) {
      console.log('📊 Test 3: Ensemble Consensus (Maximum Accuracy)');
      console.log('-'.repeat(40));

      const llm3 = new LLMService(process.env.OPENAI_API_KEY!, {
        anthropic: process.env.ANTHROPIC_API_KEY,
      });
      llm3.setMultiPass(false);
      llm3.setConsensus(true);
      llm3.setConsensusConfig({
        strategy: 'ensemble',
        ensemble: {
          enabled: true,
          minimumAgreement: 2,
          models: ['gpt-4o-mini', 'gpt-4o', 'claude-3-5-sonnet'],
        },
      });

      try {
        const ensembleStart = Date.now();
        const ensembleResult = await llm3.parseTranscript(parseRequest);
        const ensembleTime = Date.now() - ensembleStart;

        console.log(`✅ Items: ${ensembleResult.totalItems}`);
        console.log(`💰 Cost: $${(ensembleResult.estimatedCost || 0).toFixed(4)}`);
        console.log(`⏱️  Time: ${(ensembleTime / 1000).toFixed(1)}s\n`);

        results.ensemble.totalItems += ensembleResult.totalItems;
        results.ensemble.totalCost += ensembleResult.estimatedCost || 0;
        results.ensemble.totalTime += ensembleTime;
      } catch (error) {
        console.error('❌ Ensemble consensus failed:', error);
      }
    }

    // Wait a bit between videos to avoid rate limits
    if (i < videoRows.length - 1) {
      console.log('\n⏳ Waiting 2s before next video...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Final Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('📈 FINAL SUMMARY - 24h Videos');
  console.log('='.repeat(80));

  console.log(`\n📹 Tested ${videoRows.length} video(s) from last 24 hours\n`);

  const baselineCost = results.singleModel.totalCost;
  const baselineTime = results.singleModel.totalTime;

  console.log('1️⃣  Single Model (Baseline):');
  console.log(`   Total Items: ${results.singleModel.totalItems}`);
  console.log(`   Total Cost: $${results.singleModel.totalCost.toFixed(4)}`);
  console.log(`   Total Time: ${(results.singleModel.totalTime / 1000).toFixed(1)}s`);
  console.log(`   Avg per video: ${(results.singleModel.totalItems / videoRows.length).toFixed(1)} items`);

  if (results.hierarchical.totalItems > 0) {
    const hierCostIncrease = ((results.hierarchical.totalCost - baselineCost) / baselineCost) * 100;
    const hierItemsChange = ((results.hierarchical.totalItems - results.singleModel.totalItems) / results.singleModel.totalItems) * 100;
    const hierTimeIncrease = ((results.hierarchical.totalTime - baselineTime) / baselineTime) * 100;

    console.log('\n2️⃣  Hierarchical Consensus:');
    console.log(`   Total Items: ${results.hierarchical.totalItems} (${hierItemsChange >= 0 ? '+' : ''}${hierItemsChange.toFixed(1)}%)`);
    console.log(`   Total Cost: $${results.hierarchical.totalCost.toFixed(4)} (${hierCostIncrease >= 0 ? '+' : ''}${hierCostIncrease.toFixed(1)}%)`);
    console.log(`   Total Time: ${(results.hierarchical.totalTime / 1000).toFixed(1)}s (${hierTimeIncrease >= 0 ? '+' : ''}${hierTimeIncrease.toFixed(1)}%)`);
    console.log(`   Avg per video: ${(results.hierarchical.totalItems / videoRows.length).toFixed(1)} items`);
  }

  if (results.ensemble.totalItems > 0) {
    const ensembleCostIncrease = ((results.ensemble.totalCost - baselineCost) / baselineCost) * 100;
    const ensembleItemsChange = ((results.ensemble.totalItems - results.singleModel.totalItems) / results.singleModel.totalItems) * 100;
    const ensembleTimeIncrease = ((results.ensemble.totalTime - baselineTime) / baselineTime) * 100;

    console.log('\n3️⃣  Ensemble Consensus:');
    console.log(`   Total Items: ${results.ensemble.totalItems} (${ensembleItemsChange >= 0 ? '+' : ''}${ensembleItemsChange.toFixed(1)}%)`);
    console.log(`   Total Cost: $${results.ensemble.totalCost.toFixed(4)} (${ensembleCostIncrease >= 0 ? '+' : ''}${ensembleCostIncrease.toFixed(1)}%)`);
    console.log(`   Total Time: ${(results.ensemble.totalTime / 1000).toFixed(1)}s (${ensembleTimeIncrease >= 0 ? '+' : ''}${ensembleTimeIncrease.toFixed(1)}%)`);
    console.log(`   Avg per video: ${(results.ensemble.totalItems / videoRows.length).toFixed(1)} items`);
  }

  console.log('\n\n💡 SIMULATION INSIGHTS');
  console.log('='.repeat(80));
  console.log('\nIf you processed all 11 videos from last 24h with consensus:');

  const scaleFactor = 11 / videoRows.length;
  const projected = {
    single: {
      items: Math.round(results.singleModel.totalItems * scaleFactor),
      cost: results.singleModel.totalCost * scaleFactor,
    },
    hierarchical: {
      items: Math.round(results.hierarchical.totalItems * scaleFactor),
      cost: results.hierarchical.totalCost * scaleFactor,
    },
  };

  console.log(`\n📊 Projected for all 11 videos:`);
  console.log(`   Single Model: ${projected.single.items} items, $${projected.single.cost.toFixed(4)}`);

  if (results.hierarchical.totalItems > 0) {
    console.log(`   Hierarchical: ${projected.hierarchical.items} items, $${projected.hierarchical.cost.toFixed(4)}`);
    console.log(`   Extra cost: $${(projected.hierarchical.cost - projected.single.cost).toFixed(4)} for better accuracy`);
  }

  console.log('\n');
  await db.close();
}

testConsensus24h().catch(console.error);

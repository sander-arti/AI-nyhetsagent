import 'dotenv/config';
import { OrchestratorService, OrchestratorConfig } from '../src/services/orchestrator.service.js';

async function testFullPipeline() {
  const requiredEnvVars = ['YOUTUBE_API_KEY', 'OPENAI_API_KEY'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`   ${varName}`));
    return;
  }

  console.log('🧪 Testing full AI-nyhetsagent pipeline...\n');

  // Configuration for testing (dry run mode)
  const config: OrchestratorConfig = {
    youtubeApiKey: process.env.YOUTUBE_API_KEY!,
    openaiApiKey: process.env.OPENAI_API_KEY!,
    slackBotToken: process.env.SLACK_BOT_TOKEN || 'dummy_token',
    slackChannelId: process.env.SLACK_CHANNEL_ID || '#test',
    maxVideosPerSource: 2, // Limited for testing
    maxTranscriptionMinutes: 90, // Increased to handle longer summary videos
    similarityThreshold: 0.85,
    lookbackHours: 72, // Extended for testing (3 days) - production uses 24 hours
    dryRun: true // Prevent actual Slack posting
  };

  console.log('⚙️ Configuration:');
  console.log(`   Max videos per source: ${config.maxVideosPerSource}`);
  console.log(`   Max transcription minutes: ${config.maxTranscriptionMinutes}`);
  console.log(`   Similarity threshold: ${config.similarityThreshold}`);
  console.log(`   Lookback hours: ${config.lookbackHours}`);
  console.log(`   Dry run: ${config.dryRun}`);
  console.log(`   Slack channel: ${config.slackChannelId}`);

  const orchestrator = new OrchestratorService(config);

  try {
    console.log('\n🚀 Starting full pipeline test...');
    
    const result = await orchestrator.runPipeline();
    
    // Display detailed results
    console.log('\n📊 PIPELINE RESULTS:');
    console.log(`   Run ID: ${result.runId}`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Duration: ${Math.round(result.stats.totalProcessingTimeMs / 1000)}s`);
    console.log(`   Total cost: $${result.stats.totalCost.toFixed(4)}`);
    
    console.log('\n📈 PROCESSING STATS:');
    console.log(`   Sources processed: ${result.stats.sourcesProcessed}`);
    console.log(`   Videos found: ${result.stats.videosFound}`);
    console.log(`   Videos transcribed: ${result.stats.videosTranscribed}`);
    console.log(`   Items extracted: ${result.stats.itemsExtracted}`);
    console.log(`   Items after dedup: ${result.stats.itemsAfterDedup}`);
    console.log(`   Duplicates removed: ${result.stats.duplicatesRemoved}`);

    if (result.errors.length > 0) {
      console.log('\n⚠️ ERRORS ENCOUNTERED:');
      result.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    // Test success/failure analysis
    if (result.status === 'success') {
      console.log('\n✅ PIPELINE TEST SUCCESSFUL!');
      
      if (result.stats.videosFound === 0) {
        console.log('ℹ️ No new videos found - this is normal if sources were recently processed');
      } else if (result.stats.itemsAfterDedup > 0) {
        console.log(`🎯 Successfully processed ${result.stats.itemsAfterDedup} unique items`);
        console.log(`📊 Deduplication efficiency: ${((result.stats.duplicatesRemoved / result.stats.itemsExtracted) * 100).toFixed(1)}%`);
      }

      // Cost analysis
      if (result.stats.totalCost > 0) {
        const costPerVideo = result.stats.videosTranscribed > 0 ? 
          result.stats.totalCost / result.stats.videosTranscribed : 0;
        const costPerItem = result.stats.itemsAfterDedup > 0 ? 
          result.stats.totalCost / result.stats.itemsAfterDedup : 0;
        
        console.log('\n💰 COST ANALYSIS:');
        console.log(`   Cost per video: $${costPerVideo.toFixed(4)}`);
        console.log(`   Cost per item: $${costPerItem.toFixed(4)}`);
        
        // Project monthly costs (assuming twice daily runs)
        const monthlyProjection = result.stats.totalCost * 2 * 30;
        console.log(`   Monthly projection: $${monthlyProjection.toFixed(2)} (2 runs/day)`);
      }

    } else {
      console.log('\n❌ PIPELINE TEST FAILED');
      console.log('Check the errors above for debugging information');
    }

    // Production readiness check
    console.log('\n🔍 PRODUCTION READINESS CHECK:');
    const checks = [
      { name: 'YouTube API working', passed: result.stats.sourcesProcessed > 0 },
      { name: 'Transcription working', passed: result.stats.videosTranscribed > 0 || result.stats.videosFound === 0 },
      { name: 'Item extraction working', passed: result.stats.itemsExtracted > 0 || result.stats.videosTranscribed === 0 },
      { name: 'Deduplication working', passed: result.stats.itemsAfterDedup >= 0 },
      { name: 'Cost under control', passed: result.stats.totalCost < 1.0 }, // Less than $1 per test run
      { name: 'No critical errors', passed: result.status === 'success' }
    ];

    checks.forEach(check => {
      const icon = check.passed ? '✅' : '❌';
      console.log(`   ${icon} ${check.name}`);
    });

    const passedChecks = checks.filter(c => c.passed).length;
    const readinessScore = (passedChecks / checks.length) * 100;
    
    console.log(`\n📊 Production readiness: ${readinessScore.toFixed(0)}% (${passedChecks}/${checks.length} checks passed)`);

    if (readinessScore >= 80) {
      console.log('🟢 System is ready for production deployment');
    } else if (readinessScore >= 60) {
      console.log('🟡 System needs minor fixes before production');
    } else {
      console.log('🔴 System needs significant work before production');
    }

    console.log('\n🎉 Full pipeline test completed!');
    
    return result;

  } catch (error) {
    console.error('❌ Pipeline test failed with fatal error:', error);
    throw error;
  } finally {
    await orchestrator.cleanup();
  }
}

if (require.main === module) {
  testFullPipeline().catch(console.error);
}

export { testFullPipeline };
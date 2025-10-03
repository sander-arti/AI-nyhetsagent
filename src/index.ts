import 'dotenv/config';
import { OrchestratorService, OrchestratorConfig } from './services/orchestrator.service.js';

async function main() {
  const config: OrchestratorConfig = {
    youtubeApiKey: process.env.YOUTUBE_API_KEY!,
    openaiApiKey: process.env.OPENAI_API_KEY!,
    slackBotToken: process.env.SLACK_BOT_TOKEN!,
    slackChannelId: process.env.SLACK_CHANNEL_ID!,
    maxVideosPerSource: parseInt(process.env.MAX_VIDEOS_PER_SOURCE || '5'),
    maxTranscriptionMinutes: parseInt(process.env.MAX_TRANSCRIPTION_MINUTES || '180'),
    similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.85'),
    lookbackHours: parseInt(process.env.LOOKBACK_HOURS || '24'),
    dryRun: process.env.DRY_RUN === 'true',
    rapidApiKey: process.env.RAPIDAPI_KEY,
    rapidApiHost: process.env.RAPIDAPI_HOST,
    rapidApiRateLimit: parseInt(process.env.RAPIDAPI_RATE_LIMIT || '10'),
    smartGrouping: {
      enabled: process.env.SMART_GROUPING_ENABLED !== 'false', // Default to enabled
      minGroupSize: parseInt(process.env.MIN_GROUP_SIZE || '2'), // 2+ items for grouping
      preserveDetails: process.env.PRESERVE_DETAILS !== 'false' // Default to true
    }
  };

  // Validate required environment variables
  const required = ['YOUTUBE_API_KEY', 'OPENAI_API_KEY', 'SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   ${key}`));
    process.exit(1);
  }

  const orchestrator = new OrchestratorService(config);

  try {
    const result = await orchestrator.runPipeline();
    
    if (result.status === 'success') {
      console.log('\n🎉 AI-nyhetsagent completed successfully!');
      process.exit(0);
    } else {
      console.error('\n💥 AI-nyhetsagent failed');
      console.error('Errors:', result.errors);
      process.exit(1);
    }

  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  } finally {
    await orchestrator.cleanup();
  }
}

if (require.main === module) {
  main();
}

export { main };
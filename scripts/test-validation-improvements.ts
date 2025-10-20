import 'dotenv/config';
import { LLMService } from '../src/services/llm.service.js';
import { LLMMetricsService } from '../src/services/llm-metrics.service.js';
import { HallucinationDetectorService } from '../src/services/hallucination-detector.service.js';

/**
 * Test script to validate the new LLM improvements:
 * - JSON Schema Mode
 * - Chain-of-thought prompts
 * - Output validation
 * - Hallucination detection
 * - Retry logic
 */

async function testValidationImprovements() {
  console.log('🧪 Testing LLM Validation Improvements');
  console.log('=' * 60);

  // Initialize services
  const openaiApiKey = process.env.OPENAI_API_KEY!;
  if (!openaiApiKey) {
    console.error('❌ OPENAI_API_KEY not found in environment');
    process.exit(1);
  }

  const llmService = new LLMService(openaiApiKey);
  const metricsService = new LLMMetricsService();
  const hallucinationDetector = new HallucinationDetectorService(openaiApiKey);

  // Ensure metrics table exists
  await metricsService.ensureMetricsTable();

  // Test case 1: News extraction with potential hallucinations
  console.log('\n📰 Test 1: News Extraction with Validation');
  console.log('-'.repeat(60));

  const newsTranscript = {
    videoId: 'test_video_1',
    text: `OpenAI announced today that they are releasing a new feature called ChatGPT Canvas.
    This is a split-screen interface that allows users to edit text directly alongside the chat.
    The feature includes version control and inline editing capabilities.
    It's rolling out to ChatGPT Plus users starting this week.`,
    segments: [
      {
        start: 0,
        end: 30,
        text: 'OpenAI announced today that they are releasing a new feature called ChatGPT Canvas. This is a split-screen interface that allows users to edit text directly alongside the chat.'
      },
      {
        start: 30,
        end: 60,
        text: 'The feature includes version control and inline editing capabilities. It rolling out to ChatGPT Plus users starting this week.'
      }
    ],
    language: 'en',
    duration: 60,
    source: 'whisper' as const,
    qualityScore: 0.9
  };

  const newsRequest = {
    transcript: newsTranscript,
    sourceType: 'news' as const,
    videoMetadata: {
      title: 'OpenAI Announces ChatGPT Canvas',
      channelName: 'AI News Daily',
      duration: 60,
      publishedAt: new Date()
    }
  };

  try {
    metricsService.initializeExtraction('test_run_1', 'test_video_1', 'news');
    const startTime = Date.now();

    const result = await llmService.parseTranscript(newsRequest);

    const processingTime = Date.now() - startTime;
    await metricsService.finalizeExtraction('test_video_1', processingTime);

    console.log(`✅ Extraction completed in ${processingTime}ms`);
    console.log(`📊 Total items extracted: ${result.totalItems}`);
    console.log(`💰 Cost: $${result.estimatedCost?.toFixed(4) || 'N/A'}`);
    console.log(`🔢 Tokens used: ${result.tokensUsed || 'N/A'}`);

    if (result.newsItems && result.newsItems.length > 0) {
      console.log('\n📋 Extracted Items:');
      for (const item of result.newsItems) {
        console.log(`\n  Title: ${item.title}`);
        console.log(`  Summary: ${item.summary}`);
        console.log(`  Entities: ${item.entities.join(', ')}`);
        console.log(`  Confidence: ${item.confidence}`);
        console.log(`  Relevance: ${item.relevance_score}/10`);
        console.log(`  RawContext: "${item.rawContext.substring(0, 100)}..."`);

        // Run hallucination detection
        console.log('\n  🔍 Running hallucination detection...');
        const hallucinationCheck = await hallucinationDetector.detectHallucinations(
          item,
          newsTranscript.text
        );

        console.log(`  Has Hallucinations: ${hallucinationCheck.hasHallucinations ? '❌ YES' : '✅ NO'}`);
        console.log(`  Confidence: ${(hallucinationCheck.confidence * 100).toFixed(1)}%`);
        console.log(`  Recommended Adjustment: ${hallucinationCheck.recommendedConfidenceAdjustment}`);

        if (hallucinationCheck.issues.length > 0) {
          console.log(`  Issues Found (${hallucinationCheck.issues.length}):`);
          for (const issue of hallucinationCheck.issues) {
            console.log(`    - [${issue.severity.toUpperCase()}] ${issue.description}`);
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Test 1 failed:', error);
  }

  // Test case 2: Debate extraction
  console.log('\n\n🧠 Test 2: Debate Extraction with Chain-of-Thought');
  console.log('-'.repeat(60));

  const debateTranscript = {
    videoId: 'test_video_2',
    text: `The panel discussed whether AI safety regulations might slow down innovation.
    Sarah Chen argued that we can't afford to move fast and break things when the stakes are this high.
    She mentioned that safety regulations prevent catastrophic risks and build public trust.
    On the other side, John Davis pointed out that regulations could slow down life-saving medical AI applications.
    He emphasized that innovation requires experimentation and freedom to fail.
    The discussion highlighted how these regulatory decisions will shape the next decade of AI development.`,
    segments: [
      {
        start: 0,
        end: 60,
        text: 'The panel discussed whether AI safety regulations might slow down innovation. Sarah Chen argued that we can\'t afford to move fast and break things when the stakes are this high.'
      },
      {
        start: 60,
        end: 120,
        text: 'She mentioned that safety regulations prevent catastrophic risks and build public trust. On the other side, John Davis pointed out that regulations could slow down life-saving medical AI applications.'
      }
    ],
    language: 'en',
    duration: 120,
    source: 'whisper' as const,
    qualityScore: 0.85
  };

  const debateRequest = {
    transcript: debateTranscript,
    sourceType: 'debate' as const,
    videoMetadata: {
      title: 'AI Safety vs Innovation Speed',
      channelName: 'Tech Policy Podcast',
      duration: 120,
      publishedAt: new Date()
    }
  };

  try {
    metricsService.initializeExtraction('test_run_2', 'test_video_2', 'debate');
    const startTime = Date.now();

    const result = await llmService.parseTranscript(debateRequest);

    const processingTime = Date.now() - startTime;
    await metricsService.finalizeExtraction('test_video_2', processingTime);

    console.log(`✅ Extraction completed in ${processingTime}ms`);
    console.log(`📊 Total items extracted: ${result.totalItems}`);

    if (result.debateItems && result.debateItems.length > 0) {
      console.log('\n📋 Extracted Debate Topics:');
      for (const item of result.debateItems) {
        console.log(`\n  Topic: ${item.topic}`);
        console.log(`  Discussed: ${item.whatWasDiscussed}`);
        console.log(`  Pro: ${item.positions.pro.join(', ')}`);
        console.log(`  Contra: ${item.positions.contra.join(', ')}`);
        console.log(`  Implications: ${item.implications}`);
        console.log(`  Confidence: ${item.confidence}`);
      }
    }
  } catch (error) {
    console.error('❌ Test 2 failed:', error);
  }

  // Test case 3: Get quality report
  console.log('\n\n📊 Test 3: Quality Metrics Report');
  console.log('-'.repeat(60));

  try {
    const report = await metricsService.getQualityReport(7);
    console.log(report);
  } catch (error) {
    console.error('❌ Test 3 failed:', error);
  }

  console.log('\n✨ All tests completed!');
}

// Run tests
testValidationImprovements().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

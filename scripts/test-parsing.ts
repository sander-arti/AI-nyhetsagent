import 'dotenv/config';
import { ItemProcessor, VideoMetadata } from '../src/processors/item.processor.js';
import { TranscriptProcessor } from '../src/processors/transcript.processor.js';
import { ItemValidator } from '../src/utils/validator.js';
import { getDatabase } from '../src/db/database.js';

async function testParsingPipeline() {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const youtubeApiKey = process.env.YOUTUBE_API_KEY;
  
  if (!openaiApiKey || !youtubeApiKey) {
    console.error('❌ Missing API keys in .env file');
    console.log('Required: OPENAI_API_KEY and YOUTUBE_API_KEY');
    return;
  }

  console.log('🧪 Testing complete parsing pipeline...\n');

  const itemProcessor = new ItemProcessor(openaiApiKey);
  const transcriptProcessor = new TranscriptProcessor(youtubeApiKey, openaiApiKey, 30);
  const validator = new ItemValidator();
  const db = getDatabase();

  try {
    // 1. Get a video with existing transcript
    console.log('📹 Finding video with transcript...');
    
    const videosWithTranscript = await db.query(`
      SELECT v.*, s.name as channel_name, s.type as source_type
      FROM videos v
      JOIN sources s ON v.source_id = s.id
      JOIN transcripts t ON v.id = t.video_id
      WHERE v.duration_seconds > 300 AND v.duration_seconds < 1800
      ORDER BY v.published_at DESC
      LIMIT 1
    `);

    if (videosWithTranscript.length === 0) {
      console.log('⚠ No videos with transcripts found. Please run transcript test first.');
      return;
    }

    const videoData = videosWithTranscript[0];
    console.log(`🎯 Testing with: "${videoData.title}"`);
    console.log(`   Channel: ${videoData.channel_name}`);
    console.log(`   Type: ${videoData.source_type}`);
    console.log(`   Duration: ${Math.floor(videoData.duration_seconds / 60)}:${(videoData.duration_seconds % 60).toString().padStart(2, '0')}`);

    // 2. Get transcript
    console.log('\n📝 Loading transcript...');
    const transcriptRows = await db.query(
      'SELECT * FROM transcripts WHERE video_id = ?',
      [videoData.id]
    );

    if (transcriptRows.length === 0) {
      console.log('❌ No transcript found for this video');
      return;
    }

    const transcriptData = transcriptRows[0];
    const processedTranscript = {
      videoId: videoData.video_id,
      text: transcriptData.text,
      segments: JSON.parse(transcriptData.segments || '[]'),
      language: transcriptData.language || 'en',
      source: 'whisper' as const,
      qualityScore: transcriptData.quality_score || 0.8,
      duration: videoData.duration_seconds
    };

    console.log(`✅ Loaded transcript: ${transcriptData.text.length} characters, ${processedTranscript.segments.length} segments`);

    // 3. Convert to VideoMetadata format
    const videoMetadata: VideoMetadata = {
      id: videoData.video_id,
      title: videoData.title,
      channelId: videoData.source_id,
      channelName: videoData.channel_name,
      duration: videoData.duration_seconds,
      publishedAt: new Date(videoData.published_at),
      url: `https://www.youtube.com/watch?v=${videoData.video_id}`
    };

    // 4. Process with ItemProcessor
    console.log('\n🧠 Processing with LLM...');
    const startTime = Date.now();
    
    const parsingResult = await itemProcessor.processVideo(
      videoMetadata,
      processedTranscript,
      {
        maxItemsPerVideo: 10,
        minConfidence: 'low',
        estimateCosts: true
      }
    );

    const processingTime = Date.now() - startTime;
    console.log(`⏱ Processing completed in ${processingTime}ms`);

    // 5. Display results
    console.log('\n📊 PARSING RESULTS:');
    console.log(`   Total Items: ${parsingResult.totalItems}`);
    console.log(`   Source Type: ${parsingResult.sourceType}`);
    console.log(`   Processing Time: ${parsingResult.processingTimeMs}ms`);
    
    if (parsingResult.tokensUsed) {
      console.log(`   Tokens Used: ${parsingResult.tokensUsed}`);
    }
    if (parsingResult.estimatedCost) {
      console.log(`   Estimated Cost: $${parsingResult.estimatedCost.toFixed(4)}`);
    }

    // 6. Show parsed items
    const allItems = [
      ...(parsingResult.newsItems || []),
      ...(parsingResult.debateItems || []),
      ...(parsingResult.devItems || [])
    ];

    if (allItems.length > 0) {
      console.log('\n📄 PARSED ITEMS:');
      allItems.forEach((item, index) => {
        console.log(`\n${index + 1}. ${item.title || item.topic}`);
        console.log(`   Type: ${item.type || 'N/A'}`);
        console.log(`   Confidence: ${item.confidence}`);
        
        if ('summary' in item) {
          console.log(`   Summary: ${item.summary.substring(0, 100)}...`);
        }
        if ('whatWasDiscussed' in item) {
          console.log(`   Discussion: ${item.whatWasDiscussed.substring(0, 100)}...`);
        }
        if ('whatChanged' in item) {
          console.log(`   What Changed: ${item.whatChanged.substring(0, 100)}...`);
        }
        
        if (item.timestamp) {
          console.log(`   Timestamp: ${item.timestamp}`);
        }
        
        if ('entities' in item && item.entities && item.entities.length > 0) {
          console.log(`   Entities: ${item.entities.join(', ')}`);
        }
        
        if (item.rawContext) {
          console.log(`   Context: "${item.rawContext.substring(0, 80)}..."`);
        }
      });
    }

    // 7. Validation testing
    console.log('\n🔍 VALIDATION TESTING:');
    if (allItems.length > 0) {
      const validationResults = await validator.validateBatch(
        allItems,
        parsingResult.sourceType,
        {
          strictMode: false,
          checkDuplicates: true,
          validateTimestamps: true,
          validateEntities: true
        }
      );

      const stats = validator.getBatchStats(validationResults);
      console.log(`   Valid Items: ${stats.validItems}/${stats.totalItems}`);
      console.log(`   Average Score: ${stats.averageScore.toFixed(2)}`);
      console.log(`   Total Errors: ${stats.errorCount}`);
      console.log(`   Total Warnings: ${stats.warningCount}`);

      // Show validation details for first item
      if (validationResults.length > 0) {
        const firstValidation = validationResults[0];
        console.log(`\n   First Item Validation:`);
        console.log(`     Valid: ${firstValidation.valid}`);
        console.log(`     Score: ${firstValidation.score.toFixed(2)}`);
        
        if (firstValidation.errors.length > 0) {
          console.log(`     Errors: ${firstValidation.errors.join(', ')}`);
        }
        if (firstValidation.warnings.length > 0) {
          console.log(`     Warnings: ${firstValidation.warnings.join(', ')}`);
        }
      }
    }

    // 8. Processing statistics
    console.log('\n📈 PROCESSING STATISTICS:');
    const processingStats = await itemProcessor.getProcessingStats();
    console.log(`   Total Items Processed: ${processingStats.totalItemsProcessed}`);
    console.log(`   Average Items Per Video: ${processingStats.averageItemsPerVideo.toFixed(1)}`);
    
    if (processingStats.confidenceDistribution) {
      console.log('   Confidence Distribution:');
      Object.entries(processingStats.confidenceDistribution).forEach(([conf, count]) => {
        console.log(`     ${conf}: ${count}`);
      });
    }
    
    console.log(`   LLM Tokens Used: ${processingStats.llmUsage.tokensUsed}`);
    console.log(`   LLM Cost: $${processingStats.llmUsage.estimatedCost.toFixed(4)}`);

    console.log('\n🎉 Parsing pipeline test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await itemProcessor.cleanup();
    await transcriptProcessor.cleanup();
    await db.close();
  }
}

if (require.main === module) {
  testParsingPipeline();
}
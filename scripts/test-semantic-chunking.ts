import 'dotenv/config';
import { LLMService } from '../src/services/llm.service.js';
import { SemanticChunkerService } from '../src/services/semantic-chunker.service.js';

/**
 * Test script for semantic chunking
 * Compares old token-based chunking vs new semantic chunking
 */

async function testSemanticChunking() {
  console.log('🧪 Testing Semantic Chunking');
  console.log('='.repeat(60));

  const openaiApiKey = process.env.OPENAI_API_KEY!;
  if (!openaiApiKey) {
    console.error('❌ OPENAI_API_KEY not found');
    process.exit(1);
  }

  const semanticChunker = new SemanticChunkerService(openaiApiKey);
  const llmService = new LLMService(openaiApiKey);

  // Test case 1: Multi-topic news summary
  console.log('\n📰 Test 1: Multi-Topic News Summary');
  console.log('-'.repeat(60));

  const newsTranscript = {
    videoId: 'test_semantic_news',
    text: `First up, OpenAI announced ChatGPT Canvas today. This new feature provides a split-screen interface for text editing.
    It includes version control and inline editing capabilities. Rolling out to Plus users this week.

    Next, Google released Gemini 2.0 with improved multimodal capabilities. The new model shows significant improvements
    in code generation and image understanding. Available through Google AI Studio.

    Moving on, Microsoft introduced Copilot Workspace for developers. This integrates AI assistance directly into
    Visual Studio Code. Features include code completion, bug detection, and automated testing.

    Finally, Meta announced Llama 3.1 with 405 billion parameters. This open-source model rivals GPT-4 in performance.
    Available for commercial use with permissive licensing.`,
    segments: [
      {
        start: 0,
        end: 15,
        text: 'First up, OpenAI announced ChatGPT Canvas today. This new feature provides a split-screen interface for text editing.'
      },
      {
        start: 15,
        end: 30,
        text: 'It includes version control and inline editing capabilities. Rolling out to Plus users this week.'
      },
      {
        start: 32,  // 2 second gap
        end: 47,
        text: 'Next, Google released Gemini 2.0 with improved multimodal capabilities. The new model shows significant improvements'
      },
      {
        start: 47,
        end: 62,
        text: 'in code generation and image understanding. Available through Google AI Studio.'
      },
      {
        start: 64,  // 2 second gap
        end: 79,
        text: 'Moving on, Microsoft introduced Copilot Workspace for developers. This integrates AI assistance directly into'
      },
      {
        start: 79,
        end: 94,
        text: 'Visual Studio Code. Features include code completion, bug detection, and automated testing.'
      },
      {
        start: 96,  // 2 second gap
        end: 111,
        text: 'Finally, Meta announced Llama 3.1 with 405 billion parameters. This open-source model rivals GPT-4 in performance.'
      },
      {
        start: 111,
        end: 126,
        text: 'Available for commercial use with permissive licensing.'
      }
    ],
    language: 'en',
    duration: 126,
    source: 'whisper' as const,
    qualityScore: 0.9
  };

  try {
    const chunks = await semanticChunker.createSemanticChunks(newsTranscript, {
      maxTokens: 6000,
      minTokens: 1000,
      similarityThreshold: 0.7,
      overlapStrategy: 'adaptive',
      preferCompleteness: true
    });

    console.log(`\n📦 Created ${chunks.length} semantic chunks:`);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`\nChunk ${i + 1}:`);
      console.log(`  Text: "${chunk.text.substring(0, 100)}..."`);
      console.log(`  Time: ${chunk.startTime}s - ${chunk.endTime}s`);
      console.log(`  Words: ${chunk.wordCount}`);
      console.log(`  Topic ID: ${chunk.topicId}`);
      console.log(`  Boundary: ${chunk.boundaryType}`);
      console.log(`  Quality: ${(chunk.qualityScore * 100).toFixed(1)}%`);
      console.log(`  Coherence: ${(chunk.semanticCoherence * 100).toFixed(1)}%`);
      console.log(`  Completeness: ${(chunk.estimatedCompleteness * 100).toFixed(1)}%`);
    }

    // Now test actual extraction with semantic chunking
    console.log(`\n🧠 Testing extraction with semantic chunking...`);
    const result = await llmService.parseTranscript({
      transcript: newsTranscript,
      sourceType: 'news',
      videoMetadata: {
        title: 'AI News Weekly Roundup',
        channelName: 'AI News Daily',
        duration: 126,
        publishedAt: new Date()
      }
    });

    console.log(`\n✅ Extraction Results:`);
    console.log(`  Total items: ${result.totalItems}`);
    console.log(`  Processing time: ${result.processingTimeMs}ms`);
    console.log(`  Cost: $${result.estimatedCost?.toFixed(4)}`);

    if (result.newsItems) {
      console.log(`\n📋 Extracted News Items:`);
      for (const item of result.newsItems) {
        console.log(`  • ${item.title}`);
        console.log(`    Entities: ${item.entities.join(', ')}`);
        console.log(`    Confidence: ${item.confidence}`);
        console.log(`    Relevance: ${item.relevance_score}/10`);
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }

  // Test case 2: Single topic (should create fewer chunks)
  console.log('\n\n📝 Test 2: Single Topic Discussion');
  console.log('-'.repeat(60));

  const singleTopicTranscript = {
    videoId: 'test_semantic_single',
    text: `Today we're discussing the new ChatGPT Canvas feature in detail. This feature represents
    a significant evolution in how users interact with AI. The split-screen interface allows
    for simultaneous editing and conversation. Users can see their work on one side while chatting
    with the AI on the other. The version control system tracks all changes automatically.
    You can roll back to any previous version with a single click. The inline editing capabilities
    let you select specific portions of text for AI assistance. This is particularly useful for
    refining specific sections without affecting the rest of your document.`,
    segments: [
      {
        start: 0,
        end: 10,
        text: 'Today we\'re discussing the new ChatGPT Canvas feature in detail. This feature represents'
      },
      {
        start: 10,
        end: 20,
        text: 'a significant evolution in how users interact with AI. The split-screen interface allows'
      },
      {
        start: 20,
        end: 30,
        text: 'for simultaneous editing and conversation. Users can see their work on one side while chatting'
      },
      {
        start: 30,
        end: 40,
        text: 'with the AI on the other. The version control system tracks all changes automatically.'
      },
      {
        start: 40,
        end: 50,
        text: 'You can roll back to any previous version with a single click. The inline editing capabilities'
      },
      {
        start: 50,
        end: 60,
        text: 'let you select specific portions of text for AI assistance. This is particularly useful for'
      },
      {
        start: 60,
        end: 70,
        text: 'refining specific sections without affecting the rest of your document.'
      }
    ],
    language: 'en',
    duration: 70,
    source: 'whisper' as const,
    qualityScore: 0.95
  };

  try {
    const chunks = await semanticChunker.createSemanticChunks(singleTopicTranscript, {
      maxTokens: 6000,
      minTokens: 1000,
      similarityThreshold: 0.7,
      overlapStrategy: 'adaptive',
      preferCompleteness: true
    });

    console.log(`\n📦 Created ${chunks.length} semantic chunk(s) (expected: 1-2 for single topic):`);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`\nChunk ${i + 1}:`);
      console.log(`  Words: ${chunk.wordCount}`);
      console.log(`  Boundary: ${chunk.boundaryType}`);
      console.log(`  Quality: ${(chunk.qualityScore * 100).toFixed(1)}%`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }

  // Test case 3: Compare with token-based (disabled semantic)
  console.log('\n\n🔄 Test 3: Comparison (Semantic vs Token-based)');
  console.log('-'.repeat(60));

  // Temporarily disable semantic chunking
  (llmService as any).useSemanticChunking = false;

  try {
    const tokenBasedResult = await llmService.parseTranscript({
      transcript: newsTranscript,
      sourceType: 'news',
      videoMetadata: {
        title: 'AI News Weekly Roundup',
        channelName: 'AI News Daily',
        duration: 126,
        publishedAt: new Date()
      }
    });

    // Re-enable semantic chunking
    (llmService as any).useSemanticChunking = true;

    const semanticResult = await llmService.parseTranscript({
      transcript: newsTranscript,
      sourceType: 'news',
      videoMetadata: {
        title: 'AI News Weekly Roundup',
        channelName: 'AI News Daily',
        duration: 126,
        publishedAt: new Date()
      }
    });

    console.log(`\n📊 Comparison Results:`);
    console.log(`\nToken-based Chunking:`);
    console.log(`  Items extracted: ${tokenBasedResult.totalItems}`);
    console.log(`  Processing time: ${tokenBasedResult.processingTimeMs}ms`);
    console.log(`  Cost: $${tokenBasedResult.estimatedCost?.toFixed(4)}`);

    console.log(`\nSemantic Chunking:`);
    console.log(`  Items extracted: ${semanticResult.totalItems}`);
    console.log(`  Processing time: ${semanticResult.processingTimeMs}ms`);
    console.log(`  Cost: $${semanticResult.estimatedCost?.toFixed(4)}`);

    const improvement = {
      itemsDiff: semanticResult.totalItems - tokenBasedResult.totalItems,
      timeDiff: semanticResult.processingTimeMs - tokenBasedResult.processingTimeMs,
      itemsPercent: ((semanticResult.totalItems - tokenBasedResult.totalItems) / tokenBasedResult.totalItems * 100).toFixed(1)
    };

    console.log(`\n📈 Improvement:`);
    console.log(`  Items: ${improvement.itemsDiff >= 0 ? '+' : ''}${improvement.itemsDiff} (${improvement.itemsPercent}%)`);
    console.log(`  Time: ${improvement.timeDiff >= 0 ? '+' : ''}${improvement.timeDiff}ms`);

  } catch (error) {
    console.error('❌ Comparison test failed:', error);
  }

  console.log('\n✨ All tests completed!');
}

// Run tests
testSemanticChunking().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

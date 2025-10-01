import 'dotenv/config';
import { DedupProcessor } from '../src/processors/dedup.processor.js';
import { EmbeddingService } from '../src/services/embedding.service.js';
import { getDatabase } from '../src/db/database.js';
import { NewsItem, ParsedItem } from '../src/types/schemas.js';

async function testDeduplication() {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  
  if (!openaiApiKey) {
    console.error('❌ Missing OPENAI_API_KEY in .env file');
    return;
  }

  console.log('🧪 Testing deduplication pipeline...\n');

  const dedupProcessor = new DedupProcessor(openaiApiKey);
  const embeddingService = new EmbeddingService(openaiApiKey);
  const db = getDatabase();

  try {
    // Step 1: Get test data from database
    console.log('📊 Fetching test items from database...');
    
    const itemRows = await db.query(`
      SELECT 
        i.*,
        v.video_id,
        v.title as video_title,
        s.id as source_id,
        s.name as channel_name
      FROM items i
      JOIN videos v ON i.video_id = v.id
      JOIN sources s ON v.source_id = s.id
      WHERE i.part = 1 -- News items only
      ORDER BY i.created_at DESC
      LIMIT 20
    `);

    if (itemRows.length === 0) {
      console.log('⚠️ No items found. Please run parsing pipeline first.');
      return;
    }

    console.log(`📄 Found ${itemRows.length} items for testing`);

    // Step 2: Convert to ParsedItem format
    const testItems: ParsedItem[] = itemRows.map(row => ({
      videoId: row.video_id,
      channelId: row.source_id,
      sourceUrl: `https://www.youtube.com/watch?v=${row.video_id}`,
      timestamp: row.timestamp_hms,
      confidence: row.confidence as 'high' | 'medium' | 'low',
      rawContext: row.summary || '', // Using summary as context for testing
      title: row.title,
      summary: row.summary,
      entities: JSON.parse(row.entities || '[]'),
      type: row.type as any,
      qualityScore: row.relevance_score
    } as NewsItem));

    // Step 3: Create artificial duplicates for testing
    console.log('🔄 Creating artificial duplicates for testing...');
    const artificialDuplicates = createArtificialDuplicates(testItems.slice(0, 3));
    const allItems = [...testItems, ...artificialDuplicates];

    console.log(`📈 Testing with ${allItems.length} items (${artificialDuplicates.length} artificial duplicates)`);

    // Step 4: Test embedding generation
    console.log('\\n🧮 Testing embedding generation...');
    const startEmbedding = Date.now();
    
    const sampleItems = allItems.slice(0, 5);
    const embeddingData = await embeddingService.generateItemEmbeddings(sampleItems);
    
    console.log(`✅ Generated ${embeddingData.length} embeddings in ${Date.now() - startEmbedding}ms`);
    console.log(`💰 Embedding cost: $${embeddingService.getUsageStats().estimatedCost.toFixed(6)}`);

    // Display embedding info
    embeddingData.forEach((data, index) => {
      const item = sampleItems[index];
      console.log(`\\n${index + 1}. Item: ${('title' in item) ? item.title : 'topic' in item ? item.topic : 'Unknown'}`);
      console.log(`   Canonical Key: ${data.canonicalKey}`);
      console.log(`   Text Content: "${data.textContent.substring(0, 80)}..."`);
      console.log(`   Embedding Dim: ${data.embedding.length}`);
    });

    // Step 5: Test similarity calculations
    console.log('\\n🔍 Testing similarity calculations...');
    if (embeddingData.length >= 2) {
      const similarity = EmbeddingService.cosineSimilarity(
        embeddingData[0].embedding,
        embeddingData[1].embedding
      );
      console.log(`   Similarity between items 1 & 2: ${similarity.toFixed(4)}`);
    }

    // Step 6: Full deduplication test (with smaller dataset to avoid ChromaDB setup issues)
    console.log('\\n🔗 Testing full deduplication pipeline...');
    
    // Use a smaller subset to avoid ChromaDB connection issues in testing
    const testSubset = allItems.slice(0, 8);
    console.log(`📋 Running deduplication on ${testSubset.length} items`);

    try {
      const result = await dedupProcessor.deduplicateItems(testSubset, 0.85);

      // Step 7: Display results
      console.log('\\n📊 DEDUPLICATION RESULTS:');
      console.log(`   Original Items: ${result.originalItems.length}`);
      console.log(`   Deduplicated Items: ${result.deduplicatedItems.length}`);
      console.log(`   Duplicates Removed: ${result.duplicatesRemoved}`);
      console.log(`   Clusters Created: ${result.clusters.length}`);
      console.log(`   Processing Time: ${result.processing_stats.processing_time_ms}ms`);
      console.log(`   Embedding Cost: $${result.processing_stats.embedding_cost.toFixed(6)}`);

      // Show cluster details
      if (result.clusters.length > 0) {
        console.log('\\n🔗 CLUSTER DETAILS:');
        result.clusters.forEach((cluster, index) => {
          console.log(`\\nCluster ${index + 1} (${cluster.members.length} members):`);
          console.log(`   Canonical: "${('title' in cluster.canonical) ? cluster.canonical.title : 'topic' in cluster.canonical ? cluster.canonical.topic : 'Unknown'}"`);
          console.log(`   Avg Similarity: ${cluster.avg_similarity_score.toFixed(3)}`);
          console.log(`   Also Covered By: ${cluster.also_covered_by.join(', ')}`);
          
          if (cluster.members.length > 1) {
            console.log(`   Duplicates:`);
            cluster.members.slice(1).forEach((member, memberIndex) => {
              const similarity = cluster.similarity_scores[memberIndex + 1];
              console.log(`     - "${('title' in member) ? member.title : 'topic' in member ? member.topic : 'Unknown'}" (${similarity.toFixed(3)})`);
            });
          }
        });
      }

      // Step 8: Test database storage
      console.log('\\n💾 Testing database storage...');
      const stats = await dedupProcessor.getDeduplicationStats();
      console.log(`   Total Clusters in DB: ${stats.total_clusters}`);
      console.log(`   Total Items Processed: ${stats.total_items_processed}`);
      console.log(`   Average Cluster Size: ${stats.avg_cluster_size.toFixed(1)}`);
      console.log(`   Duplicate Rate: ${(stats.duplicate_rate * 100).toFixed(1)}%`);

    } catch (chromaError) {
      console.warn('⚠️ ChromaDB test failed (this is expected if ChromaDB is not running):');
      console.warn('   ', chromaError.message);
      console.log('\\n📝 To test with ChromaDB, run: `docker run -p 8000:8000 chromadb/chroma`');
      
      // Continue with other tests...
    }

    console.log('\\n🎉 Deduplication testing completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await dedupProcessor.cleanup();
    await db.close();
  }
}

/**
 * Create artificial duplicates for testing
 */
function createArtificialDuplicates(originalItems: ParsedItem[]): ParsedItem[] {
  const duplicates: ParsedItem[] = [];

  originalItems.forEach((item, index) => {
    // Create near-duplicate with slight variations
    const duplicate = {
      ...item,
      videoId: `duplicate_${item.videoId}_${index}`,
      channelId: `duplicate_${item.channelId}`,
    };

    // Slight variations to test similarity threshold
    if ('title' in duplicate) {
      duplicate.title = duplicate.title.replace(/\b\w+\b/, 'Updated'); // Replace one word
    }
    if ('summary' in duplicate) {
      duplicate.summary = `Similar: ${duplicate.summary}`;
    }

    duplicates.push(duplicate);
  });

  return duplicates;
}

if (require.main === module) {
  testDeduplication();
}
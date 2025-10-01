import 'dotenv/config';
import { SlackService, SlackBriefData } from '../src/services/slack.service.js';
import { getDatabase } from '../src/db/database.js';
import { NewsItem, DebateItem, DevItem } from '../src/types/schemas.js';

async function testSlackIntegration() {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const testChannelId = process.env.SLACK_TEST_CHANNEL;
  
  if (!slackToken) {
    console.error('❌ Missing SLACK_BOT_TOKEN in .env file');
    console.log('💡 Add your Slack Bot Token to test Slack integration');
    console.log('   Get token from: https://api.slack.com/apps');
    return;
  }

  console.log('🧪 Testing Slack integration...\n');

  const slackService = new SlackService(slackToken);
  const db = getDatabase();

  try {
    // Step 1: Test connection
    console.log('🔌 Testing Slack connection...');
    const isConnected = await slackService.testConnection();
    
    if (!isConnected) {
      console.error('❌ Slack connection failed. Check your SLACK_BOT_TOKEN.');
      return;
    }
    
    console.log('✅ Slack connection successful');

    // Step 2: Get test data from database
    console.log('\\n📊 Fetching test data from database...');
    
    const itemRows = await db.query(`
      SELECT 
        i.*,
        v.video_id,
        v.title as video_title,
        v.published_at,
        s.id as source_id,
        s.name as channel_name
      FROM items i
      JOIN videos v ON i.video_id = v.id
      JOIN sources s ON v.source_id = s.id
      ORDER BY i.created_at DESC
      LIMIT 15
    `);

    if (itemRows.length === 0) {
      console.log('⚠️ No items found. Please run parsing pipeline first.');
      return;
    }

    console.log(`📄 Found ${itemRows.length} items for testing`);

    // Step 3: Convert to appropriate types and group by part
    const newsItems: NewsItem[] = [];
    const debateItems: DebateItem[] = [];
    const devItems: DevItem[] = [];

    itemRows.forEach(row => {
      const baseItem = {
        videoId: row.video_id,
        channelId: row.source_id,
        sourceUrl: `https://www.youtube.com/watch?v=${row.video_id}`,
        timestamp: row.timestamp_hms,
        confidence: row.confidence as 'high' | 'medium' | 'low',
        rawContext: row.summary || '',
        qualityScore: row.relevance_score
      };

      // Group by part (1=news, 2=debate, 3=dev)
      if (row.part === 1) {
        newsItems.push({
          ...baseItem,
          title: row.title,
          summary: row.summary,
          entities: JSON.parse(row.entities || '[]'),
          type: row.type,
        } as NewsItem);
      } else if (row.part === 2) {
        debateItems.push({
          ...baseItem,
          topic: row.title,
          whatWasDiscussed: row.summary,
          positions: { pro: ['Test pro argument'], contra: ['Test contra argument'] },
          keyQuotes: [{
            quote: 'Sample quote from the discussion',
            timestamp: row.timestamp_hms || '10:30',
            context: 'Context for the quote'
          }],
          implications: 'This topic has significant implications for the industry.',
          recommendedDeepDive: false,
          controversyLevel: 'medium'
        } as DebateItem);
      } else if (row.part === 3) {
        devItems.push({
          ...baseItem,
          title: row.title,
          changeType: 'release' as any,
          whatChanged: row.summary,
          developerAction: 'try' as any,
          links: [`https://example.com/docs/${row.video_id}`],
          affectedTechnologies: ['React', 'TypeScript'],
          difficulty: 'intermediate' as any,
          estimatedTimeToImplement: '2 hours'
        } as DevItem);
      }
    });

    console.log(`📋 Grouped items: ${newsItems.length} news, ${debateItems.length} debate, ${devItems.length} dev`);

    // Step 4: Create test brief data
    const briefData: SlackBriefData = {
      newsItems: newsItems.slice(0, 5),
      debateItems: debateItems.slice(0, 3), 
      devItems: devItems.slice(0, 4),
      runId: `test_run_${Date.now()}`,
      generatedAt: new Date(),
      stats: {
        totalVideos: 10,
        totalItems: newsItems.length + debateItems.length + devItems.length,
        processingTimeMs: 45000,
        cost: 0.0234
      }
    };

    console.log(`\\n📝 Created test brief with ${briefData.stats.totalItems} items`);

    // Step 5: Test message formatting (dry run)
    console.log('\\n🎨 Testing message formatting...');
    
    // We'll create a simple test to show the message structure
    console.log('📋 FORMATTED BRIEF PREVIEW:');
    console.log(`📊 Header: ARTI AI-brief • ${briefData.generatedAt.toLocaleDateString('nb-NO')}`);
    console.log(`📈 Stats: ${briefData.stats.totalVideos} videoer • ${briefData.stats.totalItems} items`);
    
    if (briefData.newsItems.length > 0) {
      console.log(`\\n🆕 Nyheter & oppdateringer (${briefData.newsItems.length}):`);
      briefData.newsItems.slice(0, 3).forEach((item, i) => {
        const conf = { high: 'H', medium: 'M', low: 'L' }[item.confidence];
        console.log(`  ${i + 1}. ${item.title} — ${item.summary.substring(0, 60)}... (${conf})`);
      });
    }

    if (briefData.debateItems.length > 0) {
      console.log(`\\n🧠 Tema & debatter (${briefData.debateItems.length}):`);
      briefData.debateItems.slice(0, 2).forEach((item, i) => {
        console.log(`  ${i + 1}. ${item.topic} — ${item.whatWasDiscussed.substring(0, 60)}...`);
      });
    }

    if (briefData.devItems.length > 0) {
      console.log(`\\n🛠️ For utviklere (${briefData.devItems.length}):`);
      briefData.devItems.slice(0, 2).forEach((item, i) => {
        console.log(`  ${i + 1}. ${item.title} — ${item.whatChanged.substring(0, 60)}...`);
      });
    }

    // Step 6: Test actual Slack sending (if channel provided)
    if (testChannelId) {
      console.log(`\\n📤 Sending test brief to channel ${testChannelId}...`);
      
      const result = await slackService.sendBrief(briefData, testChannelId);
      
      if (result.success) {
        console.log('✅ Brief sent successfully!');
        console.log(`📝 Message timestamp: ${result.timestamp}`);
        
        // Test idempotency
        console.log('\\n🔄 Testing idempotency (sending same brief again)...');
        const idempotencyResult = await slackService.sendBrief(briefData, testChannelId);
        
        if (idempotencyResult.success && idempotencyResult.timestamp === result.timestamp) {
          console.log('✅ Idempotency working correctly - no duplicate sent');
        } else {
          console.log('⚠️ Idempotency issue detected');
        }
        
      } else {
        console.error(`❌ Failed to send brief: ${result.error}`);
      }
    } else {
      console.log('\\n💡 To test actual Slack sending, add SLACK_TEST_CHANNEL to .env');
      console.log('   Example: SLACK_TEST_CHANNEL=C1234567890');
    }

    // Step 7: Test channel info (if channel provided)
    if (testChannelId) {
      console.log('\\n📋 Testing channel info...');
      const channelInfo = await slackService.getChannelInfo(testChannelId);
      
      if (channelInfo) {
        console.log(`✅ Channel: #${channelInfo.name} (${channelInfo.id})`);
        console.log(`   Members: ${channelInfo.num_members || 'Unknown'}`);
      } else {
        console.log('⚠️ Could not retrieve channel info');
      }
    }

    // Step 8: Get Slack statistics
    console.log('\\n📊 Testing Slack statistics...');
    const slackStats = await slackService.getSlackStats();
    console.log(`📈 Total posts: ${slackStats.totalPosts}`);
    console.log(`📈 Success rate: ${(slackStats.successRate * 100).toFixed(1)}%`);
    
    if (slackStats.lastPostAt) {
      console.log(`📅 Last post: ${slackStats.lastPostAt.toISOString()}`);
    }

    console.log('\\n🎉 Slack integration test completed!');

  } catch (error) {
    console.error('❌ Slack test failed:', error);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  testSlackIntegration();
}
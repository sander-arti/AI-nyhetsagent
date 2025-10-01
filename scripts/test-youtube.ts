import 'dotenv/config';
import { YouTubeService } from '../src/services/youtube.service.js';
import { CaptionsService } from '../src/services/captions.service.js';
import { getDatabase } from '../src/db/database.js';

async function testYouTubeIntegration() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  
  if (!apiKey) {
    console.error('YOUTUBE_API_KEY not found in .env file');
    console.log('Please add your YouTube API key to .env:');
    console.log('YOUTUBE_API_KEY=your-api-key-here');
    return;
  }

  console.log('🔬 Testing YouTube API integration...\n');

  const youtubeService = new YouTubeService(apiKey);
  const captionsService = new CaptionsService(apiKey);
  const db = getDatabase();

  try {
    // 1. Test database connection and get sources
    console.log('📊 Getting sources from database...');
    const sources = await db.query('SELECT * FROM sources WHERE active = 1 LIMIT 3');
    console.log(`Found ${sources.length} active sources to test\n`);

    for (const source of sources) {
      console.log(`🎯 Testing: ${source.name} (${source.type})`);
      console.log(`   URL: ${source.channel_url}`);

      try {
        // 2. Resolve channel ID if needed
        let channelId = source.channel_id;
        if (!channelId) {
          console.log('   Resolving channel ID...');
          const identifier = youtubeService.getChannelIdFromUrl(source.channel_url);
          channelId = await youtubeService.resolveChannelId(identifier);
          console.log(`   ✓ Channel ID: ${channelId}`);
          
          // Update in database
          await db.run('UPDATE sources SET channel_id = ? WHERE id = ?', [channelId, source.id]);
        }

        // 3. Get uploads playlist
        console.log('   Getting uploads playlist...');
        const uploadsPlaylistId = await youtubeService.getChannelUploadsPlaylistId(channelId);
        console.log(`   ✓ Uploads playlist: ${uploadsPlaylistId}`);

        // 4. Get recent videos (last 7 days)
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        
        console.log(`   Getting videos since ${weekAgo.toISOString().split('T')[0]}...`);
        const videoIds = await youtubeService.getNewVideosSince(uploadsPlaylistId, weekAgo);
        console.log(`   ✓ Found ${videoIds.length} recent videos`);

        if (videoIds.length > 0) {
          // 5. Get metadata for first video
          const firstVideoId = videoIds[0];
          console.log(`   Getting metadata for video: ${firstVideoId}`);
          const metadata = await youtubeService.getVideoMetadata([firstVideoId]);
          
          if (metadata.length > 0) {
            const video = metadata[0];
            console.log(`   ✓ Title: "${video.title}"`);
            console.log(`   ✓ Duration: ${Math.floor(video.duration / 60)}:${(video.duration % 60).toString().padStart(2, '0')}`);
            console.log(`   ✓ Published: ${video.publishedAt.toDateString()}`);

            // 6. Test captions
            console.log('   Checking captions...');
            const captions = await captionsService.getCaptions(firstVideoId);
            if (captions) {
              console.log(`   ✓ Captions available in ${captions.language} (${captions.segments.length} segments)`);
              console.log(`   ✓ Sample: "${captions.text.substring(0, 100)}..."`);
            } else {
              console.log('   ⚠ No captions available');
            }
          }
        } else {
          console.log('   ⚠ No recent videos found');
        }

      } catch (error) {
        console.error(`   ❌ Error testing ${source.name}:`, error);
      }

      console.log(''); // Empty line between sources
    }

    // 7. Show quota usage
    const quotaUsage = youtubeService.getQuotaUsage();
    console.log(`📊 Quota usage: ${quotaUsage.used}/${quotaUsage.used + quotaUsage.remaining} (${quotaUsage.percentage.toFixed(1)}%)`);
    
    console.log('✅ YouTube integration test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  testYouTubeIntegration();
}
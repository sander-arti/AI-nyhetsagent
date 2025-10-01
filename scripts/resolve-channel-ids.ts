import 'dotenv/config';
import { getDatabase } from '../src/db/database.js';
import { YouTubeService } from '../src/services/youtube.service.js';

async function resolveChannelIds() {
  const requiredEnvVars = ['YOUTUBE_API_KEY'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`   ${varName}`));
    return;
  }

  console.log('🔍 Resolving missing channel IDs...\n');

  const db = getDatabase();
  const youtubeService = new YouTubeService(process.env.YOUTUBE_API_KEY!);

  try {
    // Get sources with missing channel_ids
    const sourcesWithoutChannelId = await db.query(`
      SELECT id, name, channel_url
      FROM sources 
      WHERE channel_id IS NULL OR channel_id = ''
      ORDER BY name
    `);

    if (sourcesWithoutChannelId.length === 0) {
      console.log('✅ All sources already have channel IDs!');
      return;
    }

    console.log(`📋 Found ${sourcesWithoutChannelId.length} sources without channel_id:\n`);
    
    let successCount = 0;
    let failureCount = 0;

    for (const source of sourcesWithoutChannelId) {
      try {
        console.log(`🔍 ${source.name}`);
        console.log(`   URL: ${source.channel_url}`);
        
        // Extract identifier from URL
        const identifier = youtubeService.getChannelIdFromUrl(source.channel_url);
        console.log(`   Identifier: ${identifier}`);
        
        // Resolve to actual channel ID
        const channelId = await youtubeService.resolveChannelId(identifier);
        console.log(`   Resolved ID: ${channelId}`);
        
        // Update database
        await db.run(`
          UPDATE sources 
          SET channel_id = ? 
          WHERE id = ?
        `, [channelId, source.id]);
        
        console.log(`   ✅ Updated successfully!\n`);
        successCount++;
        
        // Small delay to respect API rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`   ❌ Failed: ${error.message}\n`);
        failureCount++;
      }
    }

    console.log(`\n📊 RESOLUTION COMPLETE:`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failureCount}`);
    console.log(`   💰 YouTube API quota used: ${youtubeService.getQuotaUsage().used} units`);

    // Verify results
    const remainingWithoutId = await db.query(`
      SELECT COUNT(*) as count
      FROM sources 
      WHERE channel_id IS NULL OR channel_id = ''
    `);

    const totalSources = await db.query(`SELECT COUNT(*) as count FROM sources`);
    
    console.log(`\n🔍 VERIFICATION:`);
    console.log(`   Total sources: ${totalSources[0].count}`);
    console.log(`   Sources with channel_id: ${totalSources[0].count - remainingWithoutId[0].count}`);
    console.log(`   Sources missing channel_id: ${remainingWithoutId[0].count}`);

    if (remainingWithoutId[0].count === 0) {
      console.log(`\n🎉 ALL CHANNEL IDS RESOLVED SUCCESSFULLY!`);
    } else {
      console.log(`\n⚠️ ${remainingWithoutId[0].count} sources still need manual resolution`);
    }

  } catch (error) {
    console.error('❌ Script failed:', error);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  resolveChannelIds().catch(console.error);
}

export { resolveChannelIds };
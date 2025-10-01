import 'dotenv/config';
import { YouTubeService } from '../src/services/youtube.service.js';
import { TranscriptProcessor } from '../src/processors/transcript.processor.js';
import { getDatabase } from '../src/db/database.js';

async function testTranscriptionPipeline() {
  const youtubeApiKey = process.env.YOUTUBE_API_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  
  if (!youtubeApiKey || !openaiApiKey) {
    console.error('❌ Missing API keys in .env file');
    console.log('Required: YOUTUBE_API_KEY and OPENAI_API_KEY');
    return;
  }

  console.log('🧪 Testing complete transcription pipeline...\n');

  const youtubeService = new YouTubeService(youtubeApiKey);
  const transcriptProcessor = new TranscriptProcessor(youtubeApiKey, openaiApiKey, 30); // 30 minutes for testing
  const db = getDatabase();

  try {
    // Get a short video from our database
    console.log('🔍 Looking for a short video to test...');
    
    const videos = await db.query(`
      SELECT v.*, s.name as channel_name
      FROM videos v
      JOIN sources s ON v.source_id = s.id
      WHERE v.duration_seconds > 60 AND v.duration_seconds < 1800
      ORDER BY v.published_at DESC
      LIMIT 3
    `);

    if (videos.length === 0) {
      console.log('⚠ No suitable videos found. Running YouTube fetch first...');
      
      // Get some recent videos
      const sources = await db.query('SELECT * FROM sources WHERE active = 1 LIMIT 1');
      if (sources.length === 0) {
        console.error('❌ No active sources found');
        return;
      }

      const source = sources[0];
      console.log(`📺 Fetching videos from ${source.name}...`);
      
      const channelId = source.channel_id || await youtubeService.resolveChannelId(
        youtubeService.getChannelIdFromUrl(source.channel_url)
      );
      
      const uploadsPlaylistId = await youtubeService.getChannelUploadsPlaylistId(channelId);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      
      const videoIds = await youtubeService.getNewVideosSince(uploadsPlaylistId, weekAgo);
      const metadata = await youtubeService.getVideoMetadata(videoIds.slice(0, 5));
      
      // Save to database
      for (const video of metadata) {
        await db.run(`
          INSERT OR REPLACE INTO videos (source_id, video_id, title, published_at, duration_seconds, url, has_captions)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          source.id,
          video.id,
          video.title,
          video.publishedAt.toISOString(),
          video.duration,
          video.url,
          0 // SQLite boolean as 0/1
        ]);
      }
      
      console.log(`✅ Saved ${metadata.length} videos to database`);
      
      // Find any video under 20 minutes for testing
      const testableVideos = metadata.filter(v => v.duration > 60 && v.duration < 1200);
      if (testableVideos.length === 0) {
        console.log('⚠ Using longest available video for testing');
        var testVideo = metadata[0];
      } else {
        var testVideo = testableVideos[0];
      }
    } else {
      var testVideo = videos[0];
    }

    console.log(`\n🎯 Testing transcription with:`);
    console.log(`   Title: ${testVideo.title}`);
    console.log(`   Duration: ${Math.floor(testVideo.duration_seconds / 60)}:${(testVideo.duration_seconds % 60).toString().padStart(2, '0')}`);
    console.log(`   Channel: ${testVideo.channel_name || 'Unknown'}`);
    console.log(`   Video ID: ${testVideo.video_id}`);

    // Convert database row to VideoMetadata format
    const videoMetadata = {
      id: testVideo.video_id,
      title: testVideo.title,
      publishedAt: new Date(testVideo.published_at),
      duration: testVideo.duration_seconds,
      channelId: testVideo.source_id,
      url: testVideo.url || `https://www.youtube.com/watch?v=${testVideo.video_id}`,
      hasCaptions: false,
    };

    // Test the complete transcript processing
    console.log('\n🔄 Starting transcript processing...');
    const transcript = await transcriptProcessor.processVideoTranscript(videoMetadata);

    if (transcript) {
      console.log('\n✅ Transcription successful!');
      console.log(`   Source: ${transcript.source}`);
      console.log(`   Language: ${transcript.language}`);
      console.log(`   Quality Score: ${transcript.qualityScore.toFixed(2)}`);
      console.log(`   Text Length: ${transcript.text.length} characters`);
      console.log(`   Segments: ${transcript.segments.length}`);
      console.log(`   Sample: "${transcript.text.substring(0, 150)}..."`);
      
      // Show first few segments with timestamps
      if (transcript.segments.length > 0) {
        console.log('\n📍 First few segments:');
        transcript.segments.slice(0, 3).forEach((seg, i) => {
          const startTime = `${Math.floor(seg.start / 60)}:${(Math.floor(seg.start % 60)).toString().padStart(2, '0')}`;
          console.log(`   ${startTime}: ${seg.text}`);
        });
      }
    } else {
      console.log('❌ Transcription failed or was skipped');
    }

    // Show processing statistics
    console.log('\n📊 Processing Statistics:');
    const stats = await transcriptProcessor.getProcessingStats();
    console.log(`   Total Transcripts: ${stats.totalTranscripts}`);
    console.log(`   Captions: ${stats.captionsCount}`);
    console.log(`   Whisper: ${stats.whisperCount}`);
    console.log(`   Average Quality: ${stats.averageQuality?.toFixed(2) || 'N/A'}`);
    console.log(`   Whisper Usage: ${stats.whisperUsage.minutesUsed.toFixed(1)}/${stats.whisperUsage.minutesUsed + stats.whisperUsage.minutesRemaining} minutes (${stats.whisperUsage.percentageUsed.toFixed(1)}%)`);

    console.log('\n🎉 Transcription pipeline test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await transcriptProcessor.cleanup();
    await db.close();
  }
}

if (require.main === module) {
  testTranscriptionPipeline();
}
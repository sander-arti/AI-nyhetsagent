import YTDlpWrap from 'yt-dlp-wrap';
import fs from 'fs';
import path from 'path';

async function testDownload() {
  // Test with the video from our database
  const testVideoUrl = 'https://www.youtube.com/watch?v=87IF1y--5Qk'; // AI Daily Brief video
  const outputPath = path.join(process.cwd(), 'temp', 'test-audio.mp3');
  
  // Ensure temp directory exists
  if (!fs.existsSync(path.dirname(outputPath))) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  }

  try {
    console.log('🔽 Testing yt-dlp download...');
    console.log(`URL: ${testVideoUrl}`);
    console.log(`Output: ${outputPath}`);
    
    const ytDlpWrap = new YTDlpWrap();
    
    // First, get video info
    console.log('\n📋 Getting video info...');
    const info = await ytDlpWrap.execPromise([
      testVideoUrl,
      '--dump-json',
      '--no-playlist',
    ]);
    
    const videoInfo = JSON.parse(info);
    console.log(`Title: ${videoInfo.title}`);
    console.log(`Duration: ${Math.floor(videoInfo.duration / 60)}:${Math.floor(videoInfo.duration % 60).toString().padStart(2, '0')}`);
    console.log(`Uploader: ${videoInfo.uploader}`);
    
    // Download audio (first 30 seconds only for testing)
    console.log('\n🎧 Downloading audio (30 second sample)...');
    await ytDlpWrap.execPromise([
      testVideoUrl,
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '5', // Medium quality for testing
      '--output', outputPath.replace('.mp3', '.%(ext)s'),
      '--no-playlist',
      '--external-downloader', 'ffmpeg',
      '--external-downloader-args', 'ffmpeg:-ss 0 -t 30', // Only first 30 seconds
    ]);

    // Check if file exists
    const actualPath = outputPath;
    if (fs.existsSync(actualPath)) {
      const stats = fs.statSync(actualPath);
      const sizeMB = stats.size / (1024 * 1024);
      console.log(`✅ Download successful!`);
      console.log(`File size: ${sizeMB.toFixed(2)} MB`);
      
      // Clean up test file
      fs.unlinkSync(actualPath);
      console.log('🧹 Test file cleaned up');
      
    } else {
      console.log('❌ Downloaded file not found');
    }

  } catch (error) {
    console.error('❌ Download test failed:', error);
  }
}

if (require.main === module) {
  testDownload();
}
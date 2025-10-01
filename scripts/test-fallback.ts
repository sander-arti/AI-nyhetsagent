import { WhisperService } from '../src/services/whisper.service.js';

async function testFallbackSystem() {
  console.log('🧪 Testing three-tier transcription fallback system...\n');
  
  // Initialize with a small quota to avoid using too much Whisper
  const whisperService = new WhisperService(
    process.env.OPENAI_API_KEY || 'fake-key', 
    0.1 // Very small quota to force fallback
  );
  
  // Test video with known transcripts (Rick Roll)
  const testVideoId = 'dQw4w9WgXcQ';
  const testTitle = 'Never Gonna Give You Up';
  const testDuration = 212; // seconds
  
  console.log(`📹 Testing with video: ${testTitle} (${testVideoId})`);
  console.log(`⏱️ Duration: ${testDuration} seconds\n`);
  
  try {
    const result = await whisperService.transcribeVideo(testVideoId, testTitle, testDuration);
    
    if (result) {
      console.log('✅ Transcription successful!');
      console.log(`📝 Source: ${result.source}`);
      console.log(`🔤 Language: ${result.language}`);
      console.log(`📊 Quality Score: ${result.qualityScore?.toFixed(2) || 'N/A'}`);
      console.log(`📏 Text length: ${result.text.length} characters`);
      console.log(`🎬 Segments: ${result.segments?.length || 0}`);
      console.log(`\n📄 First 200 characters:`);
      console.log(result.text.substring(0, 200) + '...');
      
      if (result.segments && result.segments.length > 0) {
        console.log(`\n🎯 First segment:`);
        console.log(JSON.stringify(result.segments[0], null, 2));
      }
    } else {
      console.log('❌ All transcription methods failed');
    }
    
  } catch (error) {
    console.error('💥 Test failed:', error);
  } finally {
    whisperService.cleanup();
  }
}

// Run the test
testFallbackSystem().catch(console.error);
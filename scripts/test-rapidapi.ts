import 'dotenv/config';
import { WhisperService } from '../src/services/whisper.service.js';

async function testRapidAPIIntegration() {
  console.log('🧪 Testing RapidAPI integration...\\n');
  
  // Check if RapidAPI credentials are available
  if (!process.env.RAPIDAPI_KEY || !process.env.RAPIDAPI_HOST) {
    console.log('⚠️ RapidAPI credentials not found in environment');
    console.log('   RAPIDAPI_KEY:', process.env.RAPIDAPI_KEY ? '✅ Set' : '❌ Missing');
    console.log('   RAPIDAPI_HOST:', process.env.RAPIDAPI_HOST ? '✅ Set' : '❌ Missing');
    console.log('\\n🔄 Testing without RapidAPI (will skip to Python fallback)');
  }
  
  // Initialize with RapidAPI config if available
  const rapidApiConfig = process.env.RAPIDAPI_KEY && process.env.RAPIDAPI_HOST ? {
    apiKey: process.env.RAPIDAPI_KEY,
    host: process.env.RAPIDAPI_HOST,
    rateLimit: parseInt(process.env.RAPIDAPI_RATE_LIMIT || '10')
  } : undefined;
  
  const whisperService = new WhisperService(
    'fake-key', // Invalid key to force fallback
    0.1, // Very small quota
    rapidApiConfig
  );
  
  // Test video with known transcripts (Rick Roll)
  const testVideoId = 'dQw4w9WgXcQ';
  const testTitle = 'Never Gonna Give You Up';
  const testDuration = 212; // seconds
  
  console.log(`📹 Testing with video: ${testTitle} (${testVideoId})`);
  console.log(`⏱️ Duration: ${testDuration} seconds\\n`);
  
  try {
    const result = await whisperService.transcribeVideo(testVideoId, testTitle, testDuration);
    
    if (result) {
      console.log('\\n✅ Transcription successful!');
      console.log(`📝 Source: ${result.source}`);
      console.log(`🔤 Language: ${result.language}`);
      console.log(`📊 Quality Score: ${result.qualityScore?.toFixed(2) || 'N/A'}`);
      console.log(`📏 Text length: ${result.text.length} characters`);
      console.log(`🎬 Segments: ${result.segments?.length || 0}`);
      console.log(`\\n📄 First 200 characters:`);
      console.log(result.text.substring(0, 200) + '...');
      
      if (result.segments && result.segments.length > 0) {
        console.log(`\\n🎯 First segment:`);
        console.log(JSON.stringify(result.segments[0], null, 2));
      }
      
      // Show which tier succeeded
      if (result.source === 'youtube-auto' && rapidApiConfig) {
        console.log('\\n🚀 SUCCESS: RapidAPI (Tier 1) worked!');
      } else if (result.source === 'youtube-auto' || result.source === 'youtube-manual') {
        console.log('\\n🐍 SUCCESS: Python fallback (Tier 3) worked!');
      } else if (result.source === 'whisper') {
        console.log('\\n🎧 SUCCESS: Whisper (Tier 2) worked!');
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
testRapidAPIIntegration().catch(console.error);
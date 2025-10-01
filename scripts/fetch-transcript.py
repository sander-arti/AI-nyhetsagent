#!/usr/bin/env python3
"""
YouTube Transcript Fetcher
Fetches transcripts from YouTube videos using youtube-transcript-api
"""

import sys
import json
import argparse
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound


def fetch_transcript(video_id, language_codes=None):
    """
    Fetch transcript for a YouTube video
    
    Args:
        video_id (str): YouTube video ID
        language_codes (list): List of preferred language codes (e.g., ['no', 'en', 'da'])
    
    Returns:
        dict: Transcript data with segments and metadata
    """
    try:
        # Default language preferences for Norwegian AI news content
        if language_codes is None:
            language_codes = ['no', 'en', 'da', 'sv']  # Norwegian, English, Danish, Swedish
        
        # Create API instance
        api = YouTubeTranscriptApi()
        
        # Get available transcript metadata first
        available_transcripts = api.list(video_id)
        
        # Find best transcript
        selected_transcript = None
        for lang in language_codes:
            for transcript in available_transcripts:
                if transcript.language_code == lang:
                    selected_transcript = transcript
                    break
            if selected_transcript:
                break
        
        if not selected_transcript:
            # Try to get any auto-generated transcript
            for transcript in available_transcripts:
                if transcript.is_generated and transcript.language_code in ['en', 'no']:
                    selected_transcript = transcript
                    break
        
        if not selected_transcript and available_transcripts:
            # Fallback to first available transcript
            selected_transcript = available_transcripts[0]
        
        if not selected_transcript:
            raise NoTranscriptFound("No suitable transcript found")
        
        # Fetch the actual transcript
        transcript_list = selected_transcript.fetch()
        
        # Get transcript info from the selected transcript
        transcript_info = {
            'language': selected_transcript.language,
            'language_code': selected_transcript.language_code,
            'is_generated': selected_transcript.is_generated,
            'is_translatable': selected_transcript.is_translatable
        }
        
        # Calculate total duration
        total_duration = 0
        if hasattr(transcript_list, 'snippets'):
            # New API format
            snippets = transcript_list.snippets
            if snippets:
                last_segment = snippets[-1]
                total_duration = last_segment.start + last_segment.duration
        
        # Convert to our format
        segments = []
        full_text_parts = []
        
        if hasattr(transcript_list, 'snippets'):
            # New API format
            for i, snippet in enumerate(transcript_list.snippets):
                segments.append({
                    'id': i,
                    'start': snippet.start,
                    'end': snippet.start + snippet.duration,
                    'text': snippet.text
                })
                full_text_parts.append(snippet.text)
        else:
            # Old format - list of dicts
            for i, segment in enumerate(transcript_list):
                segments.append({
                    'id': i,
                    'start': segment.get('start', 0),
                    'end': segment.get('start', 0) + segment.get('duration', 0),
                    'text': segment.get('text', '')
                })
                full_text_parts.append(segment.get('text', ''))
        
        return {
            'success': True,
            'video_id': video_id,
            'text': ' '.join(full_text_parts),
            'segments': segments,
            'language': transcript_info['language'] if transcript_info else 'unknown',
            'language_code': transcript_info['language_code'] if transcript_info else 'unknown',
            'duration': total_duration,
            'source': 'youtube-auto' if (transcript_info and transcript_info['is_generated']) else 'youtube-manual',
            'is_generated': transcript_info['is_generated'] if transcript_info else True
        }
        
    except TranscriptsDisabled:
        return {
            'success': False,
            'error': 'TRANSCRIPTS_DISABLED',
            'message': 'Transcripts are disabled for this video'
        }
        
    except NoTranscriptFound:
        return {
            'success': False,
            'error': 'NO_TRANSCRIPT_FOUND',
            'message': f'No transcripts found in languages: {language_codes}'
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': 'UNKNOWN_ERROR',
            'message': str(e)
        }


def main():
    parser = argparse.ArgumentParser(description='Fetch YouTube video transcript')
    parser.add_argument('video_id', help='YouTube video ID')
    parser.add_argument('--languages', nargs='*', 
                       help='Preferred language codes (e.g., no en da)')
    parser.add_argument('--output', choices=['json', 'text'], default='json',
                       help='Output format')
    
    args = parser.parse_args()
    
    # Fetch transcript
    result = fetch_transcript(args.video_id, args.languages)
    
    if args.output == 'json':
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.output == 'text' and result['success']:
        print(result['text'])
    elif args.output == 'text' and not result['success']:
        print(f"Error: {result['message']}", file=sys.stderr)
        sys.exit(1)
    
    # Exit with appropriate code
    sys.exit(0 if result['success'] else 1)


if __name__ == '__main__':
    main()
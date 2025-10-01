-- Add transcript_source column to transcripts table
-- This allows tracking whether transcript came from Whisper, YouTube captions, etc.

ALTER TABLE transcripts ADD COLUMN transcript_source TEXT;
-- PostgreSQL-specific schema with UUID support and pgvector
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- Sources table (YouTube channels)
CREATE TABLE IF NOT EXISTS sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('news', 'debate', 'dev')) NOT NULL,
  channel_url TEXT NOT NULL,
  channel_id TEXT UNIQUE NOT NULL,
  weight DECIMAL DEFAULT 1.0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Videos table
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id UUID REFERENCES sources(id),
  video_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER,
  url TEXT NOT NULL,
  has_captions BOOLEAN,
  transcript_source TEXT,
  language TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transcripts table
CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID REFERENCES videos(id),
  text TEXT NOT NULL,
  segments JSONB,
  quality_score DECIMAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Runs table (pipeline execution tracking)
CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT CHECK (status IN ('running', 'success', 'failed')) DEFAULT 'running',
  stats JSONB,
  error_log TEXT
);

-- Items table (parsed news/debate/dev items)
CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID REFERENCES runs(id),
  video_id UUID REFERENCES videos(id),
  part INTEGER CHECK (part IN (1, 2, 3)) NOT NULL,
  type TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  entities TEXT[],
  timestamp_hms TEXT,
  links TEXT[],
  confidence TEXT CHECK (confidence IN ('high', 'medium', 'low')),
  relevance_score DECIMAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Item embeddings for deduplication (using pgvector)
CREATE TABLE IF NOT EXISTS item_embeddings (
  item_id UUID PRIMARY KEY REFERENCES items(id),
  embedding VECTOR(1536) -- OpenAI text-embedding-3-small dimension
);

-- Clusters table (for deduplication)
CREATE TABLE IF NOT EXISTS clusters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  canonical_item_id UUID REFERENCES items(id),
  member_item_ids UUID[],
  similarity_threshold DECIMAL,
  also_covered_by JSONB
);

-- Slack posts tracking (idempotency)
CREATE TABLE IF NOT EXISTS slack_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID REFERENCES runs(id),
  channel_id TEXT NOT NULL,
  thread_ts TEXT,
  posted_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT,
  UNIQUE(run_id, channel_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_source ON videos(source_id);
CREATE INDEX IF NOT EXISTS idx_items_run ON items(run_id);
CREATE INDEX IF NOT EXISTS idx_items_part ON items(part);
CREATE INDEX IF NOT EXISTS idx_transcripts_video ON transcripts(video_id);

-- Vector index for similarity search
CREATE INDEX IF NOT EXISTS idx_item_embeddings_vector 
ON item_embeddings USING ivfflat (embedding vector_cosine_ops);
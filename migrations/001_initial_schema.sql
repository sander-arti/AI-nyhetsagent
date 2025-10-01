-- Initial schema for AI News Agent
-- Compatible with both SQLite and PostgreSQL

-- Sources table (YouTube channels)
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('news', 'debate', 'dev')) NOT NULL,
  channel_url TEXT NOT NULL,
  channel_id TEXT UNIQUE,
  weight REAL DEFAULT 1.0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Videos table
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  source_id TEXT REFERENCES sources(id),
  video_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  published_at TIMESTAMP NOT NULL,
  duration_seconds INTEGER,
  url TEXT NOT NULL,
  has_captions BOOLEAN,
  transcript_source TEXT,
  language TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transcripts table
CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  video_id TEXT REFERENCES videos(id),
  text TEXT NOT NULL,
  segments TEXT, -- JSON string for segments
  quality_score REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Runs table (pipeline execution tracking)
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP,
  status TEXT CHECK (status IN ('running', 'success', 'failed')) DEFAULT 'running',
  stats TEXT, -- JSON string for run statistics
  error_log TEXT
);

-- Items table (parsed news/debate/dev items)
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  run_id TEXT REFERENCES runs(id),
  video_id TEXT REFERENCES videos(id),
  part INTEGER CHECK (part IN (1, 2, 3)) NOT NULL,
  type TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  entities TEXT, -- JSON array as string
  timestamp_hms TEXT,
  links TEXT, -- JSON array as string
  confidence TEXT CHECK (confidence IN ('high', 'medium', 'low')),
  relevance_score REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Clusters table (for deduplication)
CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  canonical_item_id TEXT REFERENCES items(id),
  member_item_ids TEXT, -- JSON array as string
  similarity_threshold REAL,
  also_covered_by TEXT -- JSON array as string
);

-- Slack posts tracking (idempotency)
CREATE TABLE IF NOT EXISTS slack_posts (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  run_id TEXT REFERENCES runs(id),
  channel_id TEXT NOT NULL,
  thread_ts TEXT,
  posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status TEXT,
  UNIQUE(run_id, channel_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_source ON videos(source_id);
CREATE INDEX IF NOT EXISTS idx_items_run ON items(run_id);
CREATE INDEX IF NOT EXISTS idx_items_part ON items(part);
CREATE INDEX IF NOT EXISTS idx_transcripts_video ON transcripts(video_id);
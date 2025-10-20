-- Migration 004: Add LLM extraction metrics table

CREATE TABLE IF NOT EXISTS llm_extraction_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('news', 'debate', 'dev')),
  video_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,

  -- Processing stats
  total_chunks INTEGER NOT NULL DEFAULT 0,
  total_items_extracted INTEGER NOT NULL DEFAULT 0,
  validation_failures INTEGER NOT NULL DEFAULT 0,
  hallucinations_detected INTEGER NOT NULL DEFAULT 0,
  retries_attempted INTEGER NOT NULL DEFAULT 0,
  retries_successful INTEGER NOT NULL DEFAULT 0,

  -- Quality metrics
  average_confidence REAL NOT NULL DEFAULT 0,
  confidence_distribution TEXT NOT NULL DEFAULT '{"high":0,"medium":0,"low":0}',

  -- Validation details
  validation_errors TEXT NOT NULL DEFAULT '[]',
  validation_warnings TEXT NOT NULL DEFAULT '[]',

  -- Cost tracking
  tokens_used INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,

  -- Processing time
  processing_time_ms INTEGER NOT NULL DEFAULT 0,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_llm_metrics_timestamp
  ON llm_extraction_metrics(timestamp);

CREATE INDEX IF NOT EXISTS idx_llm_metrics_run_id
  ON llm_extraction_metrics(run_id);

CREATE INDEX IF NOT EXISTS idx_llm_metrics_video_id
  ON llm_extraction_metrics(video_id);

CREATE INDEX IF NOT EXISTS idx_llm_metrics_source_type
  ON llm_extraction_metrics(source_type);

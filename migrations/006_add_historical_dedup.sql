-- Migration 006: Add Historical Deduplication Support
-- Enables cross-run deduplication by storing embeddings persistently

-- Store item embeddings persistently for cross-run deduplication
CREATE TABLE IF NOT EXISTS item_embeddings_persistent (
  item_id TEXT PRIMARY KEY,
  embedding_vector TEXT, -- JSON array of embedding (for SQLite compatibility)
  canonical_key TEXT NOT NULL,
  text_content TEXT NOT NULL,
  source_id TEXT,
  channel_id TEXT,
  channel_name TEXT,
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cluster_id TEXT,
  event_type TEXT, -- product_launch, acquisition, etc.
  entity_list TEXT, -- JSON array of entities

  FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE SET NULL
);

-- Indexes for fast historical search
CREATE INDEX IF NOT EXISTS idx_embeddings_persistent_published
  ON item_embeddings_persistent(published_at DESC);

CREATE INDEX IF NOT EXISTS idx_embeddings_persistent_cluster
  ON item_embeddings_persistent(cluster_id);

CREATE INDEX IF NOT EXISTS idx_embeddings_persistent_source
  ON item_embeddings_persistent(source_id, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_embeddings_persistent_canonical
  ON item_embeddings_persistent(canonical_key);

CREATE INDEX IF NOT EXISTS idx_embeddings_persistent_event_type
  ON item_embeddings_persistent(event_type);

-- Add columns to clusters table for temporal context
ALTER TABLE clusters ADD COLUMN first_reported_at TIMESTAMP;
ALTER TABLE clusters ADD COLUMN first_reported_by TEXT;
ALTER TABLE clusters ADD COLUMN story_phase TEXT; -- breaking, follow-up, analysis
ALTER TABLE clusters ADD COLUMN time_window TEXT; -- 24h, 7d, 30d
ALTER TABLE clusters ADD COLUMN source_diversity REAL DEFAULT 0.5;
ALTER TABLE clusters ADD COLUMN cluster_quality_score REAL DEFAULT 0.5;

-- Historical dedup tracking
CREATE TABLE IF NOT EXISTS historical_dedup_actions (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  new_item_id TEXT NOT NULL,
  historical_cluster_id TEXT,
  similarity_score REAL NOT NULL,
  action TEXT NOT NULL, -- merged, marked_duplicate, kept_separate
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_historical_dedup_item
  ON historical_dedup_actions(new_item_id);

CREATE INDEX IF NOT EXISTS idx_historical_dedup_cluster
  ON historical_dedup_actions(historical_cluster_id);

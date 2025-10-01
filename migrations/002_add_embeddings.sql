-- Add embeddings table for deduplication
CREATE TABLE IF NOT EXISTS item_embeddings (
  item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  embedding_vector TEXT NOT NULL, -- JSON array stored as text
  canonical_key TEXT NOT NULL,    -- Hash for fast lookup
  text_content TEXT NOT NULL,     -- Text used for embedding
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient deduplication
CREATE INDEX IF NOT EXISTS idx_embeddings_canonical ON item_embeddings(canonical_key);
CREATE INDEX IF NOT EXISTS idx_embeddings_created ON item_embeddings(created_at);

-- Update clusters table to include more metadata
ALTER TABLE clusters ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE clusters ADD COLUMN avg_similarity_score REAL;
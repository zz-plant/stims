-- D1 schema for the stims-gallery database: preset embeddings written by the
-- embed-backfill cron (scripts/embed-backfill-worker.ts) and read by the
-- /api/visual-search fallback when Vectorize is unavailable.
-- Initialize: wrangler d1 execute stims-gallery --file=schema/d1-presets.sql

CREATE TABLE IF NOT EXISTS preset_embeddings (
  preset_id TEXT PRIMARY KEY,
  embedding TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_embeddings_preset ON preset_embeddings(preset_id);

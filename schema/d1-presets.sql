-- D1 Database schema for Community Preset Gallery
-- Initialize: wrangler d1 execute stims-gallery --file=schema/d1-presets.sql

CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'Anonymous',
  tags TEXT DEFAULT '',
  rating REAL DEFAULT 0,
  downloads INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_presets_created_at ON presets(created_at DESC);
CREATE INDEX idx_presets_rating ON presets(rating DESC);
CREATE INDEX idx_presets_downloads ON presets(downloads DESC);
CREATE INDEX idx_presets_tags ON presets(tags);

CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_id TEXT NOT NULL REFERENCES presets(id),
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(preset_id, session_id)
);

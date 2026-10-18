CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  draft TEXT NOT NULL CHECK(json_valid(draft)),
  published TEXT CHECK(published IS NULL OR json_valid(published)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','trash')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  saved_at INTEGER NOT NULL DEFAULT (unixepoch()),
  first_published_at INTEGER,
  published_at INTEGER
);
CREATE INDEX IF NOT EXISTS journal_public ON journal_entries(status, published_at DESC);
CREATE INDEX IF NOT EXISTS journal_saved ON journal_entries(saved_at DESC);
CREATE TABLE IF NOT EXISTS journal_assets (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS journal_asset_entry ON journal_assets(entry_id);

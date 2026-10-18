ALTER TABLE journal_entries ADD COLUMN trashed_at INTEGER;
-- Existing trash gets a full retention period from this upgrade, not its last save.
UPDATE journal_entries SET trashed_at = unixepoch() WHERE status = 'trash' AND trashed_at IS NULL;
CREATE INDEX IF NOT EXISTS journal_trash_expiry ON journal_entries(trashed_at) WHERE status = 'trash';

CREATE TABLE IF NOT EXISTS guestbook_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL CHECK(length(nickname) BETWEEN 1 AND 24),
  message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'published')),
  reply TEXT NOT NULL DEFAULT '' CHECK(length(reply) <= 2000),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  moderated_at INTEGER,
  replied_at INTEGER
);
CREATE INDEX IF NOT EXISTS guestbook_status_id ON guestbook_messages(status, id DESC);

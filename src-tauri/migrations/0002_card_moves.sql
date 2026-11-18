CREATE TABLE card_places (
  card_id TEXT PRIMARY KEY,
  project TEXT,
  row_key TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE move_requests (
  request_id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  title TEXT NOT NULL,
  from_row TEXT NOT NULL,
  to_row TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  note_id TEXT,
  answer TEXT,
  error TEXT
);

CREATE INDEX move_requests_by_card ON move_requests (card_id, status);

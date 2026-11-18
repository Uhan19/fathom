CREATE TABLE columns (
  project TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  width INTEGER NOT NULL,
  collapsed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE row_names (
  row_key TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  taken_at_ms INTEGER NOT NULL,
  home TEXT NOT NULL,
  cards TEXT NOT NULL
);

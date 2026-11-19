CREATE TABLE shell_tabs (
  terminal TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE column_folders (
  column_id INTEGER PRIMARY KEY,
  folder TEXT NOT NULL
);

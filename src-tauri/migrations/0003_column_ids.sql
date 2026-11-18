ALTER TABLE columns RENAME TO columns_by_project;

CREATE TABLE columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT UNIQUE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  width INTEGER NOT NULL,
  collapsed INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0
);

INSERT INTO columns (project, name, position, width, collapsed)
SELECT project, name, position, width, collapsed FROM columns_by_project ORDER BY position, project;

DROP TABLE columns_by_project;

ALTER TABLE card_places RENAME TO card_places_by_project;

CREATE TABLE card_places (
  card_id TEXT PRIMARY KEY,
  column_id INTEGER,
  row_key TEXT NOT NULL,
  position INTEGER NOT NULL
);

INSERT INTO card_places (card_id, column_id, row_key, position)
SELECT p.card_id, c.id, p.row_key, p.position
FROM card_places_by_project p LEFT JOIN columns c ON c.project = p.project;

DROP TABLE card_places_by_project;

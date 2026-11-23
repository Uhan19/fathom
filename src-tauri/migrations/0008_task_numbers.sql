CREATE TABLE task_numbers (
  number INTEGER PRIMARY KEY AUTOINCREMENT,
  home TEXT NOT NULL,
  card_id TEXT NOT NULL,
  UNIQUE (home, card_id)
);

INSERT INTO task_numbers (home, card_id)
SELECT '', CAST(id AS TEXT) FROM backlog_tasks ORDER BY id;

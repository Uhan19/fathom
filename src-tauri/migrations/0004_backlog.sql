CREATE TABLE backlog_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL,
  row_key TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL
);

CREATE INDEX backlog_tasks_by_project ON backlog_tasks (project, row_key);

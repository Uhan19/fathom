ALTER TABLE backlog_tasks ADD COLUMN reported_ms INTEGER;

CREATE TABLE seen_updates (
  home TEXT NOT NULL,
  card_id TEXT NOT NULL,
  mark TEXT NOT NULL,
  PRIMARY KEY (home, card_id)
);

CREATE TABLE update_baselines (
  home TEXT PRIMARY KEY
);

-- Reference/legacy test fixture only. Production uses db/migrations.js; see docs/MIGRATIONS.md.
-- ===== GYM VS GYM TRACKER — MULTI-TENANT SCHEMA =====

CREATE TABLE IF NOT EXISTS season_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  last_defined_round_number INTEGER NOT NULL,
  repeat_max_score INTEGER,
  battle_start_at TEXT NOT NULL,        -- ISO UTC
  ticket_day1_amount INTEGER NOT NULL,
  ticket_daily_amount INTEGER NOT NULL,
  ticket_regen_days INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS season_template_maps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_template_id INTEGER NOT NULL REFERENCES season_templates(id),
  name TEXT NOT NULL,
  type_weakness TEXT,
  image_url TEXT,
  note TEXT,
  order_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS season_template_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_template_id INTEGER NOT NULL REFERENCES season_templates(id),
  round_number INTEGER NOT NULL,
  max_score INTEGER NOT NULL,
  order_index INTEGER NOT NULL,
  UNIQUE(season_template_id, round_number)
);

CREATE TABLE IF NOT EXISTS gyms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  admin_code TEXT NOT NULL UNIQUE,
  contact_info TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gym_seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gym_id INTEGER NOT NULL REFERENCES gyms(id),
  season_template_id INTEGER NOT NULL REFERENCES season_templates(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gym_round_map_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gym_season_id INTEGER NOT NULL REFERENCES gym_seasons(id),
  round_number INTEGER NOT NULL,
  season_template_map_id INTEGER NOT NULL REFERENCES season_template_maps(id),
  current_points INTEGER NOT NULL DEFAULT 0,
  UNIQUE(gym_season_id, round_number, season_template_map_id)
);

CREATE TABLE IF NOT EXISTS gym_round_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gym_season_id INTEGER NOT NULL REFERENCES gym_seasons(id),
  round_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  UNIQUE(gym_season_id, round_number)
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gym_season_id INTEGER NOT NULL REFERENCES gym_seasons(id),
  name TEXT NOT NULL,
  avatar_url TEXT,
  is_banned INTEGER NOT NULL DEFAULT 0,
  banned_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(gym_season_id, name)
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gym_season_id INTEGER NOT NULL REFERENCES gym_seasons(id),
  round_number INTEGER NOT NULL,
  season_template_map_id INTEGER NOT NULL REFERENCES season_template_maps(id),
  member_id INTEGER NOT NULL REFERENCES members(id),
  tickets_used INTEGER NOT NULL,
  points_scored INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS gym_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gym_name TEXT NOT NULL,
  desired_slug TEXT,
  contact_info TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reject_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_entries_gymseason ON entries(gym_season_id);
CREATE INDEX IF NOT EXISTS idx_progress_gymseason ON gym_round_map_progress(gym_season_id);
CREATE INDEX IF NOT EXISTS idx_status_gymseason ON gym_round_status(gym_season_id);
CREATE INDEX IF NOT EXISTS idx_members_gymseason ON members(gym_season_id);

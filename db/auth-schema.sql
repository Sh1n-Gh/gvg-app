-- Reference/legacy test fixture only. Production uses db/migrations.js; see docs/MIGRATIONS.md.
-- P03 additive only: legacy columns remain intact until P05.
CREATE TABLE IF NOT EXISTS auth_principals (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('master','gym')),
  gym_id INTEGER REFERENCES gyms(id),
  password_hash TEXT NOT NULL,
  password_version INTEGER NOT NULL DEFAULT 1 CHECK(password_version > 0),
  session_version INTEGER NOT NULL DEFAULT 1 CHECK(session_version > 0),
  must_rotate INTEGER NOT NULL DEFAULT 0 CHECK(must_rotate IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  password_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  disabled_at TEXT,
  CHECK ((role='master' AND gym_id IS NULL) OR (role='gym' AND gym_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_one_master ON auth_principals(role) WHERE role='master';
CREATE UNIQUE INDEX IF NOT EXISTS auth_one_gym ON auth_principals(gym_id) WHERE role='gym';
CREATE TABLE IF NOT EXISTS auth_sessions (
  sid_hash BLOB PRIMARY KEY CHECK(typeof(sid_hash)='blob' AND length(sid_hash)=32),
  namespace TEXT NOT NULL CHECK(namespace IN ('master','gym')),
  principal_id INTEGER NOT NULL REFERENCES auth_principals(id),
  principal_session_version INTEGER NOT NULL,
  gym_id INTEGER REFERENCES gyms(id),
  session_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS auth_sessions_principal ON auth_sessions(principal_id);
CREATE INDEX IF NOT EXISTS auth_sessions_idle ON auth_sessions(idle_expires_at);
CREATE INDEX IF NOT EXISTS auth_sessions_absolute ON auth_sessions(absolute_expires_at);
CREATE INDEX IF NOT EXISTS auth_sessions_namespace_gym ON auth_sessions(namespace,gym_id);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket_hash BLOB PRIMARY KEY CHECK(typeof(bucket_hash)='blob' AND length(bucket_hash)=32),
  window_started_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  block_count INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER,
  updated_at INTEGER NOT NULL
);

const Database = require('better-sqlite3');
const migrations = require('./migrations');

function createDb(dbPath, { authSchema = true, env = process.env } = {}) {
  const production = env.NODE_ENV === 'production';
  // Bounded lock wait on every application connection, including startup.
  const db = new Database(dbPath, { fileMustExist: production, timeout: 5000 });
  try {
    if (production) migrations.assertCurrent(db);
    else migrations.migrate(db, { production: false, migrations: authSchema ? migrations.catalog : migrations.catalog.slice(0, 1) });
    const journalMode = db.pragma('journal_mode = WAL', { simple: true });
    if (db.name !== ':memory:' && journalMode !== 'wal') throw new Error('DB_CONFIG: WAL is required for file databases');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = FULL');
    return db;
  } catch (error) { db.close(); throw error; }
}

module.exports = { createDb };

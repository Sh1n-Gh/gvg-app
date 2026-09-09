const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const ledger = `CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  mode TEXT NOT NULL CHECK(mode IN ('applied','adopted')),
  backup_ref TEXT
)`;
const catalog = [
  { version: 1, name: 'core', baseline: true, sql: fs.readFileSync(path.join(__dirname, 'migrations/001-core.sql'), 'utf8') },
  { version: 2, name: 'auth', baseline: true, sql: fs.readFileSync(path.join(__dirname, 'migrations/002-auth.sql'), 'utf8') },
  { version: 3, name: 'auth-block-count', column: ['auth_rate_limits', 'block_count'], sql: 'ALTER TABLE auth_rate_limits ADD COLUMN block_count INTEGER NOT NULL DEFAULT 0;' },
  { version: 4, name: 'entry-query-indexes', sql: fs.readFileSync(path.join(__dirname, 'migrations/004-entry-query-indexes.sql'), 'utf8') },
];
function fail(message) { throw new Error(`MIGRATION: ${message}`); }
function normalize(sql) {
  // Preserve quoted literals: whitespace inside CHECK/default values is semantic.
  return sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|\s+|IF NOT EXISTS/gi,
    token => token.startsWith("'") || token.startsWith('"') ? token : '').replace(/;$/, '');
}
function definitions(db) {
  return db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name").all();
}
function manifest(migrations) {
  return migrations.map((m, i) => {
    if (m.version !== i + 1 || !/^[a-z0-9-]+$/.test(m.name)) fail('invalid ordered manifest');
    // Transaction ownership belongs exclusively to the runner. No nontransactional SQL.
    const tokens = m.sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"/g, ' ');
    if (/\b(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|VACUUM|PRAGMA|ATTACH|DETACH)\b/i.test(tokens)
        || /\bschema_migrations\b/i.test(m.sql)) fail(`unsupported SQL in version ${m.version}`);
    const checksum = crypto.createHash('sha256').update(JSON.stringify({ ...m, sql: m.sql.replace(/\r\n/g, '\n') })).digest('hex');
    return { ...m, checksum };
  });
}
function history(db, migrations) {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='schema_migrations'").get()) return [];
  const rows = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
  rows.forEach((r, i) => {
    const m = migrations[i];
    if (!m || r.version !== m.version || r.name !== m.name || r.checksum !== m.checksum) fail('history gap, unknown version or checksum mismatch');
  });
  return rows;
}
function applyOne(db, m) {
  if (m.baseline) {
    const reference = new Database(':memory:');
    try {
      reference.exec(m.sql);
      const expected = definitions(reference);
      const actual = definitions(db);
      const present = expected.filter(e => actual.some(a => a.name === e.name));
      if (!present.length) { db.exec(m.sql); return 'applied'; }
      if (present.length !== expected.length) fail(`partial baseline ${m.version}; manual reconciliation required`);
      for (const e of expected) {
        const a = actual.find(a => a.name === e.name);
        // P04 databases may already contain the additive block_count column.
        const sql = e.name === 'auth_rate_limits'
          ? a.sql.replace(/\bblock_count\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0\s*,/i, '').replace(/,\s*block_count\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i, '') : a.sql;
        if (a.type !== e.type || normalize(sql) !== normalize(e.sql)) fail(`baseline mismatch: ${e.name}`);
      }
      return 'adopted';
    } finally { reference.close(); }
  }
  if (m.column && db.prepare(`PRAGMA table_info(${m.column[0]})`).all().some(c => c.name === m.column[1])) return 'adopted';
  db.exec(m.sql);
  return 'applied';
}
function execute(db, migrations, backupRef = null) {
  if (db.inTransaction) fail('runner requires its own top-level transaction');
  return db.transaction(() => {
    const rows = history(db, migrations);
    if (!rows.length && !db.prepare("SELECT 1 FROM sqlite_schema WHERE name='schema_migrations'").get()) db.exec(ledger);
    const result = [];
    for (const m of migrations.slice(rows.length)) {
      try {
        const mode = applyOne(db, m);
        if (db.pragma('foreign_key_check').length) fail('foreign key check failed');
        db.prepare('INSERT INTO schema_migrations(version,name,checksum,mode,backup_ref) VALUES (?,?,?,?,?)').run(m.version, m.name, m.checksum, mode, backupRef);
        result.push({ version: m.version, name: m.name, mode });
      } catch { fail(`version ${m.version} (${m.name}) failed; batch rolled back; inspect offline`); }
    }
    return result;
  }).immediate();
}
function preflight(db, { migrations = catalog } = {}) {
  if (db.inTransaction) fail('preflight requires no active transaction');
  const list = manifest(migrations);
  const rows = history(db, list);
  if (db.pragma('quick_check', { simple: true }) !== 'ok' || db.pragma('foreign_key_check').length) fail('database integrity check failed');
  // serialize includes committed WAL pages but retains WAL header flags. The
  // isolated in-memory image has no WAL sidecar: use rollback format on the copy.
  const image = db.serialize();
  image[18] = 1;
  image[19] = 1;
  const copy = new Database(image);
  try {
    copy.pragma('foreign_keys = ON');
    return { current: rows.length, pending: execute(copy, list) };
  } finally { copy.close(); }
}
function assertCurrent(db, options = {}) {
  const list = manifest(options.migrations || catalog);
  if (history(db, list).length !== list.length) fail('run npm run db:migrate offline before startup');
}
function migrate(db, { migrations = catalog, production = process.env.NODE_ENV === 'production', backupRef } = {}) {
  if (production) fail('production requires migrateProduction backup hook');
  preflight(db, { migrations });
  db.pragma('foreign_keys = ON');
  return execute(db, manifest(migrations), backupRef);
}
async function migrateProduction(db, { beforeMigrate, migrations = catalog } = {}) {
  const unlock = db.name === ':memory:' ? () => {} : require('../scripts/operation-lock').acquire(db.name);
  try {
  const plan = preflight(db, { migrations });
  if (!plan.pending.length) return [];
  if (typeof beforeMigrate !== 'function') fail('production backup hook required');
  const receipt = await beforeMigrate({ databasePath: db.name, plan });
  if (!receipt || receipt.ok !== true || typeof receipt.reference !== 'string' || !receipt.reference.trim() || receipt.reference.length > 512) fail('backup hook must confirm success and return reference');
  db.pragma('foreign_keys = ON');
  return execute(db, manifest(migrations), receipt.reference);
  } finally { unlock(); }
}
module.exports = { catalog, preflight, assertCurrent, migrate, migrateProduction };

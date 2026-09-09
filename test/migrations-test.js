const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { catalog, migrate, preflight, assertCurrent, migrateProduction } = require('../db/migrations');
const { createDb } = require('../db');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const rows = db => db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
function fixture(fn) { const db = new Database(':memory:'); try { return fn(db); } finally { db.close(); } }

test('P18 upgrades version 3 with entry data preserved and both composite indexes', () => fixture(db => {
  migrate(db, { migrations: catalog.slice(0,3) });
  require('./p18-fixture').seed(db,1,100);
  const entries = db.prepare('SELECT * FROM entries ORDER BY id').all();
  assert.deepEqual(preflight(db).pending.map(r=>r.version),[4]);
  assert.deepEqual(migrate(db).map(r=>r.version),[4]);
  assert.deepEqual(db.prepare('SELECT * FROM entries ORDER BY id').all(),entries);
  assert.deepEqual(db.pragma('index_info(idx_entries_member_season)').map(r=>r.name),['member_id','gym_season_id']);
  assert.deepEqual(db.pragma('index_info(idx_entries_season_created)').map(r=>r.name),['gym_season_id','created_at']);
  assert.deepEqual(migrate(db),[]);
}));

test('blank database: preflight does not write; migrations and repeated run are idempotent', () => fixture(db => {
  assert.equal(preflight(db).pending.length, catalog.length);
  assert.equal(db.prepare('SELECT count(*) n FROM sqlite_schema').get().n, 0);
  assert.deepEqual(migrate(db).map(r => r.mode), catalog.map(() => 'applied'));
  const before = rows(db);
  assert.deepEqual(migrate(db), []);
  assert.deepEqual(rows(db), before);
  assertCurrent(db);
}));

for (const auth of ['none', 'old', 'current']) test(`adopt existing ${auth} schema preserving rows and sequence`, () => fixture(db => {
  db.exec(read('db/schema.sql'));
  if (auth !== 'none') db.exec(read(auth === 'old' ? 'db/migrations/002-auth.sql' : 'db/auth-schema.sql'));
  db.prepare('INSERT INTO gyms(id,name,slug,admin_code) VALUES (?,?,?,?)').run(42, 'Existing', 'existing', 'fixture');
  if (auth !== 'none') db.exec("INSERT INTO auth_principals(role,gym_id,password_hash) VALUES ('gym',42,'fixture-hash')");
  const gyms = db.prepare('SELECT * FROM gyms').all();
  const sequence = db.prepare('SELECT * FROM sqlite_sequence').all();
  const principals = auth !== 'none' ? db.prepare('SELECT * FROM auth_principals').all() : [];
  const result = migrate(db);
  assert.equal(result[0].mode, 'adopted');
  assert.equal(result[1].mode, auth === 'none' ? 'applied' : 'adopted');
  assert.deepEqual(db.prepare('SELECT * FROM gyms').all(), gyms);
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_sequence').all(), sequence);
  assert.deepEqual(db.prepare('SELECT * FROM auth_principals').all(), principals);
  assert.deepEqual(migrate(db), []);
}));

test('partial and drifted baseline fail without recording success', () => fixture(db => {
  db.exec('CREATE TABLE gyms(id INTEGER PRIMARY KEY)');
  assert.throws(() => migrate(db), /version 1/);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='schema_migrations'").get(), undefined);
  db.exec('DROP TABLE gyms');
  db.exec(read('db/schema.sql').replace('admin_code TEXT NOT NULL UNIQUE', 'admin_code TEXT'));
  assert.throws(() => migrate(db), /version 1/);
}));

test('failure midway through DDL/DML rolls back entire batch, including ledger; corrected retry works', () => fixture(db => {
  migrate(db);
  const before = rows(db);
  const good = { version: catalog.length + 1, name: 'example', sql: 'CREATE TABLE example(id INTEGER PRIMARY KEY); INSERT INTO example VALUES (1);' };
  const bad = { version: catalog.length + 2, name: 'broken', sql: 'ALTER TABLE gyms ADD COLUMN demo TEXT; INSERT INTO absent VALUES (1);' };
  assert.throws(() => migrate(db, { migrations: [...catalog, good, bad] }), /version 6/);
  assert.deepEqual(rows(db), before);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='example'").get(), undefined);
  assert.ok(!db.pragma('table_info(gyms)').some(c => c.name === 'demo'));
  migrate(db, { migrations: [...catalog, good] });
  assert.equal(db.prepare('SELECT count(*) n FROM example').get().n, 1);
}));

test('production hook gates all writes; failed hook leaves no ledger; receipt is recorded', async () => {
  const db = new Database(':memory:');
  try {
    assert.throws(() => migrate(db, { production: true }), /backup hook/);
    await assert.rejects(migrateProduction(db), /backup hook/);
    await assert.rejects(migrateProduction(db, { beforeMigrate: async () => ({ ok: false }) }), /confirm/);
    await assert.rejects(migrateProduction(db, { beforeMigrate: async () => { throw new Error('backup failed'); } }), /backup failed/);
    assert.equal(db.prepare('SELECT count(*) n FROM sqlite_schema').get().n, 0);
    let calls = 0;
    const beforeMigrate = async ({ plan }) => { calls++; assert.equal(plan.pending.length, catalog.length); return { ok: true, reference: 'test-receipt' }; };
    await migrateProduction(db, { beforeMigrate });
    assert.ok(rows(db).every(r => r.backup_ref === 'test-receipt'));
    await migrateProduction(db, { beforeMigrate });
    assert.equal(calls, 1);
  } finally { db.close(); }
});

test('actual execution failure after preflight and hook rolls back DDL/DML and ledger', async () => {
  const db = new Database(':memory:');
  try {
    migrate(db);
    const before = rows(db);
    const first = { version: catalog.length + 1, name: 'batch-first', sql: 'CREATE TABLE demo(id INTEGER); INSERT INTO demo VALUES (1);' };
    const next = { version: catalog.length + 2, name: 'hook-race', sql: "INSERT INTO gyms(name,slug,admin_code) VALUES ('x','x','x');" };
    await assert.rejects(migrateProduction(db, { migrations: [...catalog, first, next], beforeMigrate: async () => {
      db.exec("CREATE TRIGGER fixture_failure BEFORE INSERT ON gyms BEGIN SELECT RAISE(ABORT,'fixture'); END");
      return { ok: true, reference: 'fixture' };
    } }), /version 6/);
    assert.deepEqual(rows(db), before);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='demo'").get(), undefined);
    assert.equal(db.prepare('SELECT count(*) n FROM gyms').get().n, 0);
    db.exec('DROP TRIGGER fixture_failure');
    migrate(db, { migrations: [...catalog, first, next] });
  } finally { db.close(); }
});

test('checksum changes, unknown versions, gaps and transaction escape SQL are rejected', () => fixture(db => {
  migrate(db);
  assert.throws(() => preflight(db, { migrations: catalog.map((m,i) => i ? m : { ...m, sql: m.sql + '\n-- edit' }) }), /checksum/);
  assert.throws(() => preflight(db, { migrations: catalog.slice(0,2) }), /unknown/);
  db.exec('DELETE FROM schema_migrations WHERE version=2');
  assert.throws(() => preflight(db), /history/);
  for (const sql of ['COMMIT;', 'VACUUM;', 'PRAGMA foreign_keys=OFF;', 'ATTACH DATABASE \'x\' AS x;']) {
    assert.throws(() => preflight(db, { migrations: [...catalog, { version: catalog.length + 1, name: 'unsafe', sql }] }), /unsupported/);
  }
}));

test('file CLI preflight is read-only, missing DB needs init, production startup requires versions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvg-p16-'));
  const filename = path.join(dir, 'fixture.db');
  const cli = args => spawnSync(process.execPath, ['scripts/migrate-db.js', ...args], { cwd: path.join(__dirname, '..'), env: { ...process.env, NODE_ENV: 'production', DB_PATH: filename, MIGRATION_BACKUP_HOOK: '' }, encoding: 'utf8' });
  try {
    assert.equal(cli(['--dry-run']).status, 1);
    assert.equal(cli(['--dry-run', '--init']).status, 0);
    assert.equal(fs.existsSync(filename), false);
    const db = new Database(filename); db.exec(read('db/schema.sql')); db.close();
    const before = fs.readFileSync(filename);
    assert.equal(cli(['--dry-run']).status, 0);
    assert.deepEqual(fs.readFileSync(filename), before);
    assert.throws(() => createDb(filename, { env: { NODE_ENV: 'production' } }), /offline/);
    assert.deepEqual(fs.readFileSync(filename), before);
    assert.equal(cli([]).status, 1);
    const migrated = createDb(filename, { env: {} }); migrated.close();
    const ready = createDb(filename, { env: { NODE_ENV: 'production' } }); ready.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('WAL snapshot preflight sees committed rows without changing source or history', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvg-p16-wal-'));
  const db = new Database(path.join(dir, 'fixture.db'));
  try {
    db.pragma('journal_mode=WAL');
    db.exec(read('db/schema.sql'));
    db.exec("INSERT INTO gyms(name,slug,admin_code) VALUES ('wal','wal','fixture')");
    const next = { version: catalog.length + 1, name: 'verify-wal', sql: 'CREATE TABLE wal_probe(n INTEGER CHECK(n=1)); INSERT INTO wal_probe SELECT count(*) FROM gyms;' };
    assert.equal(preflight(db, { migrations: [...catalog, next] }).pending.length, catalog.length + 1);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='schema_migrations'").get(), undefined);
    migrate(db);
    assert.equal(db.prepare('SELECT count(*) n FROM gyms').get().n, 1);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});


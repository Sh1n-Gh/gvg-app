const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createDb } = require('../db');
const pw = require('../auth/password');
const { migrateCredentials } = require('../auth/migrate');
const { validateConfig } = require('../auth/config');
const env = { MASTER_ADMIN_CODE: 'fixture-only-code' };
function gym(db, code, n = 1) { db.prepare('INSERT INTO gyms(name,slug,admin_code) VALUES (?,?,?)').run('Gym', `gym-${n}`, code); }

test('Argon2 salt, exact Unicode/null bytes, wrong password, strict parser and policy', async () => {
  const password = '  mật khẩu 🔑\0abc  ';
  const a = await pw.hashPassword(password);
  const b = await pw.hashPassword(password);
  assert.notEqual(a,b);
  assert.equal(await pw.verifyPassword(password,a),true);
  assert.equal(await pw.verifyPassword(password.trim(),a),false);
  assert.equal(await pw.verifyPassword('wrong',a),false);
  assert.equal(pw.needsRehash(a),false);
  for (const bad of [null, '', a + '\n', a.replace('m=19456','m=999999999'), a.replace('argon2id','argon2i')]) {
    assert.equal(await pw.verifyPassword(password,bad),false);
    assert.equal(pw.needsRehash(bad),true);
  }
  await assert.rejects(pw.hashPassword('short'));
  await assert.rejects(pw.hashPassword('a'.repeat(257)));
  await assert.rejects(pw.hashPassword('\ud800'.repeat(12)));
  assert.throws(() => pw.assertRuntime({}), /AUTH_RUNTIME/);
});

test('blank DB, legacy gyms including deleted, partial retry and idempotence', async () => {
  const db = createDb(':memory:');
  try {
    assert.deepEqual(await migrateCredentials(db,{env}),{migrated:1,skipped:0,failed:0});
    gym(db,'a',1); gym(db,' 短\0 ',2);
    db.prepare('UPDATE gyms SET deleted_at=datetime(\'now\') WHERE id=2').run();
    assert.deepEqual(await migrateCredentials(db,{env}),{migrated:2,skipped:1,failed:0});
    const before = db.prepare('SELECT * FROM auth_principals ORDER BY id').all();
    assert.deepEqual(await migrateCredentials(db,{env:{}}),{migrated:0,skipped:3,failed:0});
    assert.deepEqual(db.prepare('SELECT * FROM auth_principals ORDER BY id').all(),before);
    for (const row of db.prepare('SELECT g.admin_code,p.password_hash,p.must_rotate FROM gyms g JOIN auth_principals p ON p.gym_id=g.id').all()) {
      assert.equal(await pw.verifyPassword(row.admin_code,row.password_hash),true);
      assert.equal(row.must_rotate,1);
    }
    assert.throws(() => db.prepare("INSERT INTO auth_principals(role,password_hash) VALUES ('gym','x')").run());
    assert.throws(() => db.prepare("INSERT INTO auth_principals(role,password_hash) VALUES ('master','x')").run());
  } finally { db.close(); }
});

test('hash and insert failure are atomic; retry preserves old codes', async () => {
  const db = createDb(':memory:');
  try {
    gym(db,'a',1); gym(db,'b',2);
    let calls = 0;
    await assert.rejects(migrateCredentials(db,{env,hash: async (...args) => { if (++calls === 2) throw new Error('sensitive'); return pw.hashPassword(...args); }}),/AUTH_MIGRATION/);
    assert.equal(db.prepare('SELECT count(*) n FROM auth_principals').get().n,0);
    db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON auth_principals WHEN NEW.role='master' BEGIN SELECT RAISE(ABORT,'private'); END");
    await assert.rejects(migrateCredentials(db,{env}),/AUTH_MIGRATION/);
    assert.equal(db.prepare('SELECT count(*) n FROM auth_principals').get().n,0);
    assert.deepEqual(db.prepare('SELECT admin_code FROM gyms ORDER BY id').all(),[{admin_code:'a'},{admin_code:'b'}]);
    db.exec('DROP TRIGGER fail_insert');
    assert.equal((await migrateCredentials(db,{env})).migrated,3);
  } finally { db.close(); }
});

test('missing and duplicate legacy codes fail preflight', async () => {
  for (const codes of [[null],[''],['same','same']]) {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE gyms(id INTEGER PRIMARY KEY, admin_code TEXT)');
      for (const code of codes) db.prepare('INSERT INTO gyms(admin_code) VALUES (?)').run(code);
      await assert.rejects(migrateCredentials(db,{env}));
    } finally { db.close(); }
  }
});

test('real legacy SQLite backup restores business data and rerun requires new backup', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'gvg-auth-'));
  const db = new Database(path.join(dir,'legacy.db'));
  try {
    db.exec(fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8'));
    db.pragma('journal_mode=WAL'); gym(db,'old',1);
    const backupPath = path.join(dir,'before.db');
    await assert.rejects(migrateCredentials(db,{env}),/backup/);
    await migrateCredentials(db,{env,backupPath});
    const restored = new Database(backupPath);
    try {
      assert.equal(restored.pragma('integrity_check',{simple:true}),'ok');
      assert.equal(restored.prepare('SELECT admin_code FROM gyms').get().admin_code,'old');
      assert.equal(restored.prepare("SELECT count(*) n FROM sqlite_master WHERE name='auth_principals'").get().n,0);
    } finally { restored.close(); }
    await assert.rejects(migrateCredentials(db,{env,backupPath}),/backup/);
  } finally { db.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});

test('production configuration is fail-fast and errors contain only setting names', async () => {
  const db = createDb(':memory:');
  try {
    const config = {NODE_ENV:'production',PUBLIC_ORIGIN:'https://example.test',SESSION_SECRETS:'s'.repeat(32),AUTH_RATE_LIMIT_SECRET:'r'.repeat(32),...env};
    for (const key of ['SESSION_SECRETS','AUTH_RATE_LIMIT_SECRET','MASTER_ADMIN_CODE']) {
      const bad = {...config}; delete bad[key];
      assert.throws(() => validateConfig(db,bad),err => err.message.startsWith('AUTH_CONFIG:') && !err.message.includes(env.MASTER_ADMIN_CODE));
    }
    validateConfig(db,config);
    await migrateCredentials(db,{env});
    validateConfig(db,config);
    assert.throws(() => validateConfig(db,{...config,AUTH_RATE_LIMIT_SECRET:config.SESSION_SECRETS}));
  } finally { db.close(); }
});

test('production process rejects missing secrets before listening without leaking input', () => {
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'gvg-start-'));
  try {
    createDb(path.join(dir, 'startup.db'), { env: {} }).close();
    for (const missing of ['SESSION_SECRETS','AUTH_RATE_LIMIT_SECRET','MASTER_ADMIN_CODE']) {
      const config = {...process.env, NODE_ENV:'production',PUBLIC_ORIGIN:'https://example.test',DB_PATH:path.join(dir,'startup.db'),PORT:'0',
        SESSION_SECRETS:'s'.repeat(32),AUTH_RATE_LIMIT_SECRET:'r'.repeat(32),MASTER_ADMIN_CODE:'private-test-input',MASTER_ADMIN_BOOTSTRAP_PASSWORD:''};
      config[missing]='';
      const result = spawnSync(process.execPath,[path.join(__dirname,'../server.js')],{env:config,encoding:'utf8',timeout:5000});
      assert.equal(result.status,1);
      assert.equal(JSON.parse(result.stdout.trim()).event, 'startup_failed');
      assert.equal(result.stderr, '');
      assert.equal((result.stdout+result.stderr).includes('private-test-input'),false);
      assert.equal(result.stdout.includes('"event":"server_started"'),false);
    }
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('CLI migration and production HTTP checkpoint work with explicit configuration', async () => {
  const { spawnSync, spawn } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'gvg-checkpoint-'));
  let child;
  try {
    const config = {...process.env,NODE_ENV:'production',PUBLIC_ORIGIN:'https://example.test',DB_PATH:path.join(dir,'app.db'),PORT:'0',
      AUTH_MIGRATION_BACKUP_PATH:path.join(dir,'before.db'),SESSION_SECRETS:'s'.repeat(32),
      AUTH_RATE_LIMIT_SECRET:'r'.repeat(32),MASTER_ADMIN_CODE:'fixture-code',MASTER_ADMIN_BOOTSTRAP_PASSWORD:''};
    const hookPath = path.join(dir, 'backup-hook.cjs');
    fs.writeFileSync(hookPath, "exports.beforeMigrate = async () => ({ok:true,reference:'test-only-empty-db'});");
    const schema = spawnSync(process.execPath, [path.join(__dirname, '../scripts/migrate-db.js'), '--init'], {
      env: { ...config, MIGRATION_BACKUP_HOOK: hookPath }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(schema.status, 0, schema.stderr);
    const migrated = spawnSync(process.execPath,[path.join(__dirname,'../scripts/migrate-auth.js')],{env:config,encoding:'utf8',timeout:5000});
    assert.equal(migrated.status,0);
    assert.deepEqual(JSON.parse(migrated.stdout.trim()),{migrated:1,skipped:0,failed:0});
    child = spawn(process.execPath,[path.join(__dirname,'../server.js')],{env:config,stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject) => {
      const timeout = setTimeout(() => reject(new Error('startup timeout')),5000);
      child.once('exit',() => {clearTimeout(timeout); reject(new Error('startup exited'));});
      child.stdout.on('data',data => { if(data.toString().includes('http://localhost')) {clearTimeout(timeout); resolve();} });
    });
  } finally {
    if (child && child.exitCode === null) { const closed = new Promise(resolve => child.once('exit',resolve)); child.kill(); await closed; }
    fs.rmSync(dir,{recursive:true,force:true});
  }
});


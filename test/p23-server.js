// Isolated child server: no caller-supplied URL, DB path, environment or real data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvg-p23-'));
const db = require('../db').createDb(path.join(dir, 'fixture.db'), { env: {} });
let app, server, busy = 0;
async function close() {
  app?.locals.auth.close();
  if (server) await new Promise(r => server.close(r));
  const result = { entries: db.prepare('SELECT count(*) n FROM entries').get().n,
    integrity: db.pragma('integrity_check', { simple: true }), foreignKeys: db.pragma('foreign_key_check'), busy };
  db.close();
  assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
  assert.ok(path.basename(dir).startsWith('gvg-p23-'));
  assert.equal(fs.lstatSync(dir).isSymbolicLink(), false);
  fs.rmSync(dir, { recursive: true });
  process.send?.({ closed: result });
  process.disconnect?.();
}
(async () => {
  require('./p18-fixture').seed(db, 1, 10000, 5);
  db.exec("UPDATE entries SET created_at=replace(substr(created_at,1,19),'T',' ')");
  db.prepare('UPDATE members SET name=? WHERE id=1').run('Thành viên tên dài kiểm tra giao diện Nguyễn Thị Minh Anh');
  require('../engine').recomputeRoundChain(db, 1);
  await require('../auth/migrate').migrateCredentials(db, { env: { MASTER_ADMIN_CODE: 'p23-master-fixture-password' }, backupPath: path.join(dir, 'auth-backup.db') });
  app = require('../server').createApp(db, {
    env: { NODE_ENV: 'test', SESSION_SECRETS: 's'.repeat(32), AUTH_RATE_LIMIT_SECRET: 'r'.repeat(32) },
    mapImages: { serve: async () => { throw new Error('p23-private-error-canary'); } },
    logger: { log(_level, _event, fields) { if (/SQLITE_BUSY|SQLITE_LOCKED|database locked|database is locked/i.test(JSON.stringify(fields))) busy++; } }
  });
  // Count SQLite lock failures at the driver, even if the HTTP error is sanitized.
  const prepare = db.prepare.bind(db);
  db.prepare = (...args) => {
    const statement = prepare(...args);
    for (const method of ['run', 'get', 'all']) {
      const original = statement[method].bind(statement);
      statement[method] = (...values) => { try { return original(...values); } catch (e) { if (/^SQLITE_(BUSY|LOCKED)/.test(e.code)) busy++; throw e; } };
    }
    return statement;
  };
  server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  process.on('message', message => { if (message === 'close') close().catch(e => { console.error(e); process.exit(1); }); });
})().catch(e => { console.error(e); process.exitCode = 1; });

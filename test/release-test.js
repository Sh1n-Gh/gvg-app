const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { release } = require('../scripts/release');
const { acquire } = require('../scripts/operation-lock');
const { readiness } = require('../scripts/release-readiness');
const http = require('node:http');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p21-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'fixture.db'); fs.writeFileSync(databasePath, 'fixture');
  const calls = [];
  const adapter = Object.fromEntries(['verifyArtifact', 'maintenance', 'stop', 'backup', 'migrate', 'activate', 'start', 'ready', 'record', 'assertSchema', 'restore'].map(name =>
    [name, async () => { calls.push(name); return name === 'backup' ? { ok: true, database: 'private-ref', files: 'private-ref', verified: true } : true; }]));
  return { adapter, calls, request: { mode: 'deploy', databasePath, digest: 'a'.repeat(64) } };
}
test('deploy gates backup before migration and readiness before reopening', async t => {
  const f = fixture(t); await release(f.adapter, f.request);
  assert.deepEqual(f.calls, ['verifyArtifact', 'maintenance', 'stop', 'backup', 'record', 'migrate', 'assertSchema', 'activate', 'start', 'ready', 'record', 'maintenance']);
});
for (const failure of ['backup', 'migrate', 'assertSchema', 'activate', 'ready']) {
  test(`failure at ${failure} stays stopped and redacts provider error`, async t => {
    const f = fixture(t); f.adapter[failure] = async () => { throw new Error('secret-value'); };
    await assert.rejects(release(f.adapter, f.request), /stopped in maintenance/);
    assert.deepEqual(f.calls.slice(-2), ['maintenance', 'stop']);
  });
}
test('incomplete backup receipt blocks mutation', async t => {
  const f = fixture(t); f.adapter.backup = async () => ({ ok: true, database: 'ref' });
  await assert.rejects(release(f.adapter, f.request)); assert.ok(!f.calls.includes('migrate'));
});
test('code rollback never runs migrations', async t => {
  const f = fixture(t); f.request.mode = 'rollback'; await release(f.adapter, f.request);
  assert.ok(!f.calls.includes('migrate')); assert.ok(f.calls.includes('assertSchema'));
});
test('restore requires explicit data loss approval and validates target schema', async t => {
  const f = fixture(t); Object.assign(f.request, { mode: 'rollback', restore: true });
  await assert.rejects(release(f.adapter, f.request)); assert.ok(!f.calls.includes('restore'));
  Object.assign(f.request, { dataLossApproved: true, recoveryRef: 'private-reference' });
  f.calls.length = 0; await release(f.adapter, f.request);
  assert.ok(f.calls.indexOf('restore') < f.calls.indexOf('assertSchema'));
});
test('migration lock rejects second OS process and releases normally', t => {
  const f = fixture(t); const unlock = acquire(f.request.databasePath);
  const child = spawnSync(process.execPath, ['-e', `require('./scripts/operation-lock').acquire(${JSON.stringify(f.request.databasePath)})`], { encoding: 'utf8' });
  assert.notEqual(child.status, 0); unlock(); acquire(f.request.databasePath)();
});
test('release lock excludes simultaneous jobs without stopping existing job', async t => {
  const f = fixture(t); const unlock = acquire(f.request.databasePath, '.release-lock');
  await assert.rejects(release(f.adapter, f.request)); assert.deepEqual(f.calls, ['verifyArtifact']); unlock();
});
test('readiness checks local endpoint, Host, JSON and failed status', async t => {
  let healthy = true;
  const server = http.createServer((req, res) => {
    assert.equal(req.url, '/ready'); assert.equal(req.headers.host, 'gvg.example.invalid');
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: healthy ? 'ok' : 'unavailable' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const options = { port: server.address().port, host: 'gvg.example.invalid', attempts: 1 };
  assert.equal(await readiness(options), true);
  healthy = false; assert.equal(await readiness(options), false);
});
test('production migration holds lock across asynchronous backup hook', async t => {
  const f = fixture(t); fs.unlinkSync(f.request.databasePath);
  const Database = require('better-sqlite3');
  const { migrateProduction } = require('../db/migrations');
  const first = new Database(f.request.databasePath), second = new Database(f.request.databasePath);
  try {
    let finish;
    const pending = migrateProduction(first, { beforeMigrate: () => new Promise(resolve => { finish = resolve; }) });
    await assert.rejects(migrateProduction(second, { beforeMigrate: async () => ({ ok: true, reference: 'ref' }) }));
    finish({ ok: true, reference: 'fixture-backup' }); await pending;
    assert.deepEqual(await migrateProduction(second), []);
  } finally { first.close(); second.close(); }
});

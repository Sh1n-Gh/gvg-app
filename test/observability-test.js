const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { createLogger, redact } = require('../security/observability');
const { installShutdown } = require('../security/lifecycle');
const { createApp } = require('../server');
const { createDb } = require('../db');
const { migrateCredentials } = require('../auth/migrate');
const env = { MASTER_ADMIN_BOOTSTRAP_PASSWORD: 'test-bootstrap-password', NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://gvg.example.invalid', TRUST_PROXY: '127.0.0.1', SESSION_SECRETS: 's'.repeat(32), AUTH_RATE_LIMIT_SECRET: 'r'.repeat(32) };
async function fixture(serve = (req, res) => res.end()) {
  const lines = [], db = createDb(':memory:');
  await migrateCredentials(db, { env });
  const app = createApp(db, { env, logger: createLogger(env, line => lines.push(JSON.parse(line))), mapImages: { serve } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  function request(path, headers = {}) {
    let request;
    const result = new Promise((resolve, reject) => {
      request = http.get({ hostname: '127.0.0.1', port: server.address().port, path, headers: { Host: 'gvg.example.invalid', ...headers } }, res => {
        let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      request.on('error', reject);
    });
    return { request, result };
  }
  return { app, server, db, lines, request, async close() {
    app.locals.auth.close(); if (server.listening) await new Promise(r => server.close(r)); if (db.open) db.close();
  } };
}
test('log schema redacts all secrets, nested payloads, free text, getters and spoofed metadata in every environment', () => {
  for (const NODE_ENV of ['production', 'development', 'test', 'secret-canary']) {
    const lines = [], logger = createLogger({ NODE_ENV }, line => lines.push(line));
    const fields = { password: 'secret-canary', Cookie: 'secret-canary', authorization: 'secret-canary', admin_code: 'secret-canary', token: 'secret-canary', email: 'secret-canary', body: { password: 'secret-canary' }, error: new Error('secret-canary'), method: 'secret-canary', request_id: 'secret-canary', environment: 'secret-canary', status: 500, toJSON() { throw Error('must not invoke'); } };
    fields.circular = fields;
    Object.defineProperty(fields, 'duration_ms', { get() { throw Error('must not invoke'); } });
    logger.log('error', 'request_error', fields);
    assert.equal(lines.length, 1); assert.doesNotMatch(lines[0], /secret-canary|password|Cookie|authorization|admin_code|token|email|stack/);
    assert.equal(JSON.parse(lines[0]).status, 500);
    logger.log('error', 'secret-canary', fields); assert.equal(lines.length, 1);
  }
  assert.deepEqual(redact({ body: { secret: 1 }, status: '500' }), {});
});
test('log level filters predictably and sink failures do not break requests', () => {
  const lines = [], logger = createLogger({ NODE_ENV: 'production', LOG_LEVEL: 'warn' }, l => lines.push(l));
  logger.log('info', 'server_started'); logger.log('warn', 'readiness_failed'); assert.equal(lines.length, 1);
  assert.doesNotThrow(() => createLogger({}, () => { throw Error('sink'); }).log('error', 'startup_failed'));
});
test('health/readiness minimal, uncached, Host protected; readiness fails on real DB access failure and draining', async () => {
  const f = await fixture();
  try {
    for (const path of ['/health', '/ready']) {
      const r = await f.request(path).result; assert.equal(r.status, 200); assert.deepEqual(JSON.parse(r.body), { status: 'ok' }); assert.equal(r.headers['cache-control'], 'no-store');
    }
    assert.equal((await f.request('/health', { Host: 'evil.invalid' }).result).status, 400);
    f.app.locals.lifecycle.draining = true;
    assert.equal((await f.request('/ready').result).status, 503);
    assert.equal((await f.request('/health').result).status, 200);
    assert.equal((await f.request('/master').result).status, 503);
    f.app.locals.lifecycle.draining = false;
    f.db.close();
    const r = await f.request('/ready').result; assert.equal(r.status, 503); assert.doesNotMatch(r.body, /SQL|database|schema|stack|path/);
    assert.equal((await f.request('/health').result).status, 200);
    assert.ok(f.lines.some(l => l.event === 'readiness_failed'));
  } finally { await f.close(); }
});
test('HTTP logs correlate errors without headers, URLs, query, PII or exception text', async () => {
  const f = await fixture(async () => { throw Error('secret-canary SQL /private/file'); });
  try {
    const r = await f.request('/uploads/map-images/secret-canary?token=secret-canary', { Authorization: 'Bearer secret-canary', Cookie: 'secret-canary', 'X-Request-ID': 'secret-canary' }).result;
    assert.equal(r.status, 500);
    const logs = f.lines.filter(l => l.request_id === r.headers['x-request-id']);
    assert.equal(logs.filter(l => l.event === 'request_complete').length, 1); assert.ok(logs.some(l => l.event === 'request_error'));
    assert.doesNotMatch(JSON.stringify(f.lines), /secret-canary|private|Bearer|SQL/);
  } finally { await f.close(); }
});
for (const aborted of [false, true]) test(`SIGTERM drains async database write, client aborted=${aborted}, repeated signals safe`, async () => {
  let release, started;
  const gate = new Promise(r => release = r), entered = new Promise(r => started = r);
  let wrote = false;
  const f = await fixture(async (req, res) => { started(); await gate; req.db.prepare("INSERT INTO gyms(name,slug,admin_code) VALUES ('test','test','test')").run(); wrote = true; res.end('done'); });
  try {
    const r = f.request('/uploads/map-images/slow'); const result = r.result.catch(() => null); await entered;
    if (aborted) r.request.destroy();
    const signals = new EventEmitter();
    const shutdown = installShutdown(f.server, f.app, f.db, { signals, exit: () => assert.fail('unexpected forced exit') });
    signals.emit('SIGTERM'); signals.emit('SIGINT'); const pending = shutdown();
    assert.equal(f.db.open, true); assert.equal(f.app.locals.lifecycle.draining, true);
    release(); await pending;
    assert.equal(wrote, true); assert.equal(f.db.open, false); assert.equal(signals.listenerCount('SIGTERM'), 0);
    if (!aborted) assert.equal((await result).body, 'done'); else await result;
    assert.equal(f.lines.filter(l => l.event === 'shutdown_complete').length, 1);
  } finally { release(); await f.close(); }
});
test('shutdown deadline reports failure without closing DB under a pending operation', async () => {
  const f = await fixture(); let release;
  try {
    const operation = f.app.locals.lifecycle.track(() => new Promise(r => release = r));
    let expired; const expiration = new Promise(r => expired = r);
    const shutdown = installShutdown(f.server, f.app, f.db, { timeoutMs: 30, signals: new EventEmitter(), exit: expired });
    const pending = shutdown(); assert.equal(await expiration, 1); assert.equal(f.db.open, true);
    assert.ok(f.lines.some(l => l.event === 'shutdown_timeout'));
    release(); await operation; await pending; assert.equal(f.db.open, false);
  } finally { release?.(); await f.close(); }
});

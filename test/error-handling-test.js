const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../db');
const { createApp } = require('../server');
const { migrateCredentials } = require('../auth/migrate');
const { PublicError } = require('../security/errors');
const envFor = mode => ({ NODE_ENV: mode, TRUST_PROXY: '127.0.0.1', PUBLIC_ORIGIN: 'https://gvg.example.invalid', SESSION_SECRETS: 's'.repeat(32), AUTH_RATE_LIMIT_SECRET: 'r'.repeat(32), MASTER_ADMIN_BOOTSTRAP_PASSWORD: 'test-bootstrap-password' });
async function fixture(mode = 'production') {
  const db = createDb(':memory:');
  const env = envFor(mode);
  await migrateCredentials(db, { env });
  const app = createApp(db, { env, mapImages: { serve: async req => {
    if (req.path === '/constraint') db.prepare("INSERT INTO gyms(name,slug,admin_code) VALUES ('x','duplicate','test')").run();
    else if (req.path === '/validation') throw new PublicError('Dữ liệu không hợp lệ: name');
    else throw Object.assign(new Error('SQL secret-canary /private/database.sqlite C:\private\secret'), req.path === '/status400' ? { status: 400 } : {});
  } } });
  db.prepare("INSERT INTO gyms(name,slug,admin_code) VALUES ('x','duplicate','test')").run();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  return { db, async get(path, options = {}) {
    return new Promise((resolve, reject) => {
      const request = require('node:http').request('http://127.0.0.1:' + server.address().port + path, { method: options.method || 'GET', headers: { Host: 'gvg.example.invalid', ...options.headers } }, res => {
        let text = ''; res.on('data', chunk => text += chunk);
        res.on('end', () => resolve({ status: res.statusCode, headers: new Headers(res.headers), text }));
      });
      request.on('error', reject); request.end(options.body);
    });
  }, async close() { app.locals.auth.close(); await new Promise(r => server.close(r)); db.close(); } };
}
function check(r, status, code) {
  assert.equal(r.status, status);
  const body = JSON.parse(r.text);
  assert.equal(body.code, code);
  assert.equal(body.request_id, r.headers.get('x-request-id'));
  assert.match(body.request_id, /^[a-f0-9-]{36}$/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(r.text, /secret-canary|SQLITE|private|stack|SELECT|INSERT/);
  assert.deepEqual(Object.keys(body).sort(), ['code', 'error', 'request_id']);
  return body;
}
test('404 route, missing gym, API HTML negotiation, IDs and early Host rejection', async () => {
  const f = await fixture(); try {
    const a = check(await f.get('/missing', { headers: { 'X-Request-ID': 'secret-canary' } }), 404, 'NOT_FOUND');
    const b = check(await f.get('/g/missing/state', { headers: { Accept: 'text/html' } }), 404, 'NOT_FOUND');
    assert.notEqual(a.request_id, b.request_id);
    check(await f.get('/', { headers: { Host: 'evil.invalid' } }), 400, 'INVALID_REQUEST');
    const page = await f.get('/g/missing', { headers: { Accept: 'text/html' } });
    assert.equal(page.status, 404); assert.match(page.text, /Không tìm thấy trang/); assert.ok(page.text.includes('href="/"'));
  } finally { await f.close(); }
});
test('validation, malformed JSON, body limit and unknown status400 do not disclose input', async () => {
  const f = await fixture(); try {
    check(await f.get('/g/duplicate/seasons/no/state'), 400, 'INVALID_REQUEST');
    const valid = check(await f.get('/uploads/map-images/validation'), 400, 'INVALID_REQUEST');
    assert.match(valid.error, /name/);
    check(await f.get('/uploads/map-images/status400'), 400, 'INVALID_REQUEST');
    check(await f.get('/master/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"secret-canary"' }), 400, 'INVALID_REQUEST');
    check(await f.get('/master/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(9000) }), 413, 'PAYLOAD_TOO_LARGE');
  } finally { await f.close(); }
});
test('real SQLite constraint and query failures plus unexpected async rejection are sanitized', async () => {
  const f = await fixture(); try {
    check(await f.get('/uploads/map-images/constraint'), 409, 'CONFLICT');
    check(await f.get('/uploads/map-images/unexpected'), 500, 'INTERNAL_ERROR');
    f.db.exec('ALTER TABLE gyms RENAME TO gyms_unavailable');
    check(await f.get('/g/duplicate/state'), 500, 'INTERNAL_ERROR');
    const page = await f.get('/g/duplicate', { headers: { Accept: 'text/html' } });
    assert.equal(page.status, 500); assert.match(page.text, /Tạm thời không thể tải trang/);
    assert.doesNotMatch(page.text, /SQLITE|gyms|stack/);
  } finally { await f.close(); }
});
test('development provides debugging, default environment fails closed', async () => {
  for (const mode of ['development', '']) {
    const f = await fixture(mode); try {
      const r = await f.get('/uploads/map-images/unexpected');
      if (mode === 'development') {
        const body = JSON.parse(r.text); assert.equal(r.status, 500);
        assert.match(body.debug.message, /secret-canary/); assert.match(body.debug.stack, /Error:/);
      } else check(r, 500, 'INTERNAL_ERROR');
    } finally { await f.close(); }
  }
});


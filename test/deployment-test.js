const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
function request(url, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, res => {
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(body) }));
    }).on('error', reject);
  });
}
const { configureDeployment, listenOptions } = require('../security/deployment');
const { createApp } = require('../server');
const { createDb } = require('../db');
const production = { NODE_ENV: 'production', TRUST_PROXY: '127.0.0.1', PUBLIC_ORIGIN: 'https://gvg.example.invalid' };

test('production fails closed for missing origin or incorrect proxy topology; localhost bind is mandatory', () => {
  for (const TRUST_PROXY of ['', 'true', '1', '0.0.0.0/0', '10.0.0.1']) {
    assert.throws(() => configureDeployment(express(), { ...production, TRUST_PROXY }));
  }
  for (const PUBLIC_ORIGIN of ['', 'http://example.com', 'https://example.com/path', 'https://*.example.com', 'https://127.0.0.1', 'https://example.com:8443']) {
    assert.throws(() => configureDeployment(express(), { ...production, PUBLIC_ORIGIN }));
  }
  assert.deepEqual(listenOptions({ ...production, HOST: '0.0.0.0' }), { host: '127.0.0.1', port: 3000 });
  assert.equal(listenOptions({ HOST: '0.0.0.0' }).host, '0.0.0.0');
  assert.throws(() => listenOptions({ PORT: 'invalid' }));
});

test('raw and forwarded Host allowlist; trusted client IP/protocol; local development', async () => {
  for (const env of [production, {}]) {
    const app = express(); configureDeployment(app, env);
    app.get('/', (req, res) => res.json({ ip: req.ip, secure: req.secure }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    try {
      const url = `http://127.0.0.1:${server.address().port}/`;
      for (const host of ['evil.invalid', 'gvg.example.invalid.evil.invalid', 'gvg.example.invalid:80', 'gvg.example.invalid,evil.invalid']) {
        const r = await request(url, { headers: { Host: host, 'X-Forwarded-Host': 'gvg.example.invalid' } });
        assert.equal(r.status, env.NODE_ENV ? 400 : 200);
      }
      const badForward = await request(url, { headers: { Host: 'gvg.example.invalid', 'X-Forwarded-Host': 'evil.invalid' } });
      assert.equal(badForward.status, env.NODE_ENV ? 400 : 200);
      for (const host of ['gvg.example.invalid', 'GVG.EXAMPLE.INVALID:443']) {
        const r = await request(url, { headers: { Host: host, 'X-Forwarded-For': '203.0.113.9', 'X-Forwarded-Proto': 'https' } });
        assert.equal(r.status, 200);
        assert.deepEqual(await r.json(), { ip: env.NODE_ENV ? '203.0.113.9' : '127.0.0.1', secure: !!env.NODE_ENV });
      }
    } finally { await new Promise(r => server.close(r)); }
  }
});

test('application serves public assets but does not expose repository, database or backup paths', async () => {
  const db = createDb(':memory:');
  const app = createApp(db, { env: {} });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const p of ['/.env', '/.git/config', '/server.js', '/package.json', '/db/gvg.db', '/backups/backup.db', '/auth/config.js', '/season-configs/private.json', '/%2eenv']) {
      assert.equal((await request(base + p)).status, 404, p);
    }
    assert.equal((await request(base + '/')).status, 200);
  } finally { app.locals.auth.close(); await new Promise(r => server.close(r)); db.close(); }
});

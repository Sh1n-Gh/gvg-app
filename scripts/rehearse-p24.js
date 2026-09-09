// Local fixture only. No configurable target, domain, secret or database input.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const migrations = require('../db/migrations');
const { backup, restore, verify } = require('./sqlite-backup');
const { release } = require('./release');
const { readiness } = require('./release-readiness');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gvg-p24-'));
const databasePath = path.join(directory, 'fixture.db');
const backupDir = path.join(directory, 'backups');
fs.mkdirSync(backupDir);
const events = [], checks = [], logs = [];
let child, port, currentDb = databasePath, active = 'previous-simulation';
const secret = () => crypto.randomBytes(32).toString('hex');
const password = secret();
const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: directory,
  NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://gvg.example.invalid', TRUST_PROXY: '127.0.0.1',
  SESSION_SECRETS: secret(), AUTH_RATE_LIMIT_SECRET: secret(), BACKUP_DIR: backupDir,
  MIGRATION_BACKUP_HOOK: path.join(__dirname, 'sqlite-backup.js') };
function check(name, ok) { assert.ok(ok, name); checks.push(name); }
function request(route, method = 'GET', data, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method,
      headers: { Host: 'gvg.example.invalid', 'X-Forwarded-Proto': 'https',
        Origin: env.PUBLIC_ORIGIN, 'Content-Type': 'application/json', ...headers } }, res => {
      let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(5000, () => req.destroy(new Error('request timeout')));
    req.on('error', reject); req.end(data ? JSON.stringify(data) : undefined);
  });
}
async function stop() {
  if (!child) return;
  const stopped = child; child = undefined;
  if (stopped.exitCode === null) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { stopped.kill(); reject(new Error('stop timeout')); }, 10000);
      stopped.once('exit', () => { clearTimeout(timer); resolve(); }); stopped.kill('SIGTERM');
    });
  }
}
async function start() {
  const socket = net.createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
  port = socket.address().port; await new Promise(r => socket.close(r));
  child = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: directory, env: { ...env, DB_PATH: currentDb, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => logs.push(b.toString()));
  check('release readiness ' + active, await readiness({ port, host: 'gvg.example.invalid', attempts: 30, delayMs: 100 }));
}
async function smoke(label) {
  for (const route of ['/health', '/ready']) {
    const r = await request(route); check(label + route, r.status === 200 && JSON.parse(r.body).status === 'ok');
  }
  const r = await request('/master/auth/login', 'POST', { password });
  check(label + ' login', r.status === 200);
  const cookie = r.headers['set-cookie'].join(';');
  check(label + ' secure cookie', /__Host-/.test(cookie) && /HttpOnly/i.test(cookie) && /Secure/i.test(cookie) && /SameSite=Lax/i.test(cookie) && /Path=\//i.test(cookie) && !/Domain=/i.test(cookie));
  check(label + ' CSP/HSTS/headers', !!r.headers['content-security-policy'] && !!r.headers['strict-transport-security'] && r.headers['x-content-type-options'] === 'nosniff');
  check(label + ' unauthenticated guard', (await request('/master/gyms')).status === 401);
  check(label + ' host rejection', (await request('/ready', 'GET', null, { Host: 'evil.invalid' })).status === 400);
  for (const route of ['/.env', '/.git/config', '/server.js', '/package.json', '/db/gvg.db', '/backups/backup.db']) {
    check(label + ' private ' + route, (await request(route)).status === 404);
  }
  const plain = await request('/master/auth/login', 'POST', { password }, { 'X-Forwarded-Proto': 'http' });
  check(label + ' no cookie on HTTP', !plain.headers['set-cookie']);
}
async function main() {
  const nginx = fs.readFileSync(path.join(root, 'deploy/nginx.conf.example'), 'utf8');
  const unit = fs.readFileSync(path.join(root, 'deploy/gvg.service.example'), 'utf8');
  check('STATIC ONLY fixed HTTPS redirect', nginx.includes('return 308 https://gvg.example.invalid$request_uri;'));
  check('STATIC ONLY TLS versions and unknown SNI rejection', nginx.includes('ssl_protocols TLSv1.2 TLSv1.3;') && nginx.includes('ssl_reject_handshake on;'));
  check('STATIC ONLY proxy replaces forwarding headers', nginx.includes('proxy_set_header X-Forwarded-For $remote_addr;') && nginx.includes('proxy_set_header X-Forwarded-Proto https;'));
  check('production listener configured loopback even with wildcard HOST', require('../security/deployment').listenOptions({ ...env, HOST: '0.0.0.0' }).host === '127.0.0.1');
  check('STATIC ONLY service user and permission restrictions', unit.includes('User=gvg') && unit.includes('UMask=0077') && unit.includes('ProtectSystem=strict'));
  let db = new Database(databasePath);
  migrations.migrate(db, { migrations: migrations.catalog.slice(0, 3) });
  const hash = await require('../auth/password').hashPassword(password);
  db.prepare("INSERT INTO auth_principals(role,gym_id,password_hash,must_rotate) VALUES ('master',NULL,?,0)").run(hash);
  db.close();
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'server.js'))).digest('hex');
  let snapshot;
  const adapter = {
    async verifyArtifact(req) { check('source digest simulation', req.digest === digest); },
    async maintenance(value) { events.push('maintenance:' + value); },
    async stop() { events.push('stop'); await stop(); },
    async backup() {
      events.push('backup'); snapshot = await backup({ source: currentDb, directory: backupDir });
      const copy = path.join(directory, 'verified-' + crypto.randomUUID() + '.db');
      await restore(snapshot.path, copy); const db = new Database(copy); verify(db); db.close();
      // No runtime uploads or season files are created by this rehearsal.
      return { ok: true, verified: true, database: snapshot.reference, files: 'SIMULATED-empty-runtime-files' };
    },
    async record(receipt) { events.push('record:' + receipt.phase); fs.appendFileSync(path.join(directory, 'receipts.jsonl'), JSON.stringify(receipt) + '\n'); },
    async migrate() {
      events.push('migrate');
      const result = spawnSync(process.execPath, [path.join(__dirname, 'migrate-db.js')], { cwd: directory, env: { ...env, DB_PATH: currentDb }, encoding: 'utf8', timeout: 30000, windowsHide: true });
      check('production migration CLI exit 0', result.status === 0);
      const db = new Database(currentDb); const rows = db.prepare('SELECT version,backup_ref FROM schema_migrations ORDER BY version').all();
      check('migration 004 applied with backup receipt', rows.length === 4 && !!rows[3].backup_ref); db.close();
    },
    async assertSchema() { events.push('schema'); const db = new Database(currentDb, { readonly: true }); try { migrations.assertCurrent(db); verify(db); } finally { db.close(); } },
    async activate(req) { active = req.mode === 'deploy' ? 'candidate-simulation' : 'previous-same-schema-simulation'; events.push('activate:' + active); },
    async start() { events.push('start'); await start(); },
    async ready() { events.push('ready'); await smoke(active); return true; },
    async restore() { throw new Error('Separate restore drill only'); }
  };
  const begun = Date.now();
  await release(adapter, { mode: 'deploy', databasePath, digest });
  const deployMs = Date.now() - begun;
  const rollbackAt = Date.now();
  await release(adapter, { mode: 'rollback', databasePath, digest });
  const rollbackMs = Date.now() - rollbackAt;
  check('rollback did not run down migration', events.filter(e => e === 'migrate').length === 1);
  await stop();
  const restoreAt = Date.now();
  currentDb = path.join(directory, 'separate-restored.db');
  await restore(snapshot.path, currentDb);
  const restored = new Database(currentDb); verify(restored); migrations.assertCurrent(restored);
  check('restore principal count', restored.prepare('SELECT count(*) n FROM auth_principals').get().n === 1); restored.close();
  check('original database retained', fs.existsSync(databasePath));
  active = 'separate-restore'; await start(); await smoke(active); await stop();
  check('injected secrets absent from child logs', [password, env.SESSION_SECRETS, env.AUTH_RATE_LIMIT_SECRET].every(s => !logs.join('').includes(s)));
  const result = { scope: 'local Windows fixture; production-mode app, simulated artifact/maintenance/file backup/code switch; no TLS or provider',
    directory, node: process.version, deployMs, rollbackMs, restoreMs: Date.now() - restoreAt, checks, events,
    sourceDigest: digest, backupDigest: crypto.createHash('sha256').update(fs.readFileSync(snapshot.path)).digest('hex'),
    limitations: ['same source used for both release labels, no historical artifact', 'no actual reverse proxy/TLS/firewall/Linux permissions/secret manager', 'runtime file backup and off-server encryption simulated', 'Windows process termination does not certify systemd graceful drain', 'restore time excludes off-server download/decryption; synthetic master only'] };
  fs.mkdirSync(path.join(root, 'tmp/p24'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tmp/p24/rehearsal.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ checks: checks.length, deployMs, rollbackMs, restoreMs: result.restoreMs, result: 'PASS local simulation' }));
}
main().catch(() => { console.error('P24 rehearsal failed; inspect local fixture and checks without printing secrets.'); process.exitCode = 1; }).finally(stop);

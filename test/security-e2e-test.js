const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createDb } = require('../db');
const { createApp } = require('../server');
const { migrateCredentials } = require('../auth/migrate');
const { createStore } = require('../security/map-images');
const { TTL } = require('../auth/session-store');

const password = role => `p22-${role}-fixture-password`;
const payload = '<img src=x onerror="window.__p22=1">';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

// Never accepts a DB path, server URL, secret or upload path from the environment.
async function fixture(t, browser) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gvg-p22-'));
  const db = createDb(':memory:');
  let app, server;
  const contexts = [];
  t.after(async () => {
    try { for (const context of contexts) await context.close(); }
    finally {
      app?.locals.auth.close();
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      db.close();
      // Delete only the exact directory returned by mkdtemp, never a configured path.
      assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
      assert.ok(path.basename(directory).startsWith('gvg-p22-'));
      assert.equal(fs.lstatSync(directory).isSymbolicLink(), false);
      fs.rmSync(directory, { recursive: true });
      assert.equal(fs.existsSync(directory), false);
    }
  });
  for (const slug of ['a', 'b']) db.prepare('INSERT INTO gyms(name,slug,admin_code) VALUES (?,?,?)').run(slug, slug, password(slug));
  db.exec(`INSERT INTO season_templates(id,name,is_active,last_defined_round_number,battle_start_at,ticket_day1_amount,ticket_daily_amount,ticket_regen_days)
    VALUES (1,'P22 season',1,1,'2026-01-01',10,1,1);
    INSERT INTO season_template_maps(id,season_template_id,name,order_index) VALUES (1,1,'Map',1);
    INSERT INTO season_template_rounds(season_template_id,round_number,max_score,order_index) VALUES (1,1,100,1);
    INSERT INTO gym_seasons(id,gym_id,season_template_id) VALUES (1,1,1),(2,2,1);
    INSERT INTO members(id,gym_season_id,name) VALUES (1,1,'Member A'),(2,2,'Member B');`);
  for (const id of [1, 2]) require('../engine').recomputeRoundChain(db, id);
  await migrateCredentials(db, { env: { MASTER_ADMIN_CODE: password('master') } });
  let time = Date.now();
  app = createApp(db, { env: { NODE_ENV: 'test', SESSION_SECRETS: 's'.repeat(32), AUTH_RATE_LIMIT_SECRET: 'r'.repeat(32) }, now: () => time, mapImages: createStore(directory), logger: { log() {} } });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function context() {
    const c = await browser.newContext(); contexts.push(c);
    // No external fonts, avatars or other services are needed by this suite.
    await c.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await c.addInitScript(() => { window.__p22 = 0; });
    return c;
  }
  async function request(c, route, method = 'GET', data, headers = {}) {
    return c.request.fetch(base + route, { method, data, headers: { Origin: base, ...headers } });
  }
  async function login(c, role) {
    const prefix = role === 'master' ? '/master' : `/g/${role}/admin`;
    const response = await request(c, prefix + '/auth/login', 'POST', { password: password(role) });
    assert.equal(response.status(), 200);
    return { 'X-CSRF-Token': (await response.json()).csrf_token };
  }
  const snapshot = () => ['gyms', 'members', 'entries', 'gym_seasons', 'season_templates', 'auth_principals'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
  return { db, base, directory, context, request, login, snapshot, advance: ms => { time += ms; } };
}

test('P22 real browser + HTTP security regression', { timeout: 180000 }, async t => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) });
  t.after(() => browser.close());

  for (const role of ['master', 'a']) for (const expiry of ['idle', 'absolute']) {
    await t.test(`${role}: UI login, refresh, ${expiry} expiry, re-login, logout and replay`, async t => {
      const f = await fixture(t, browser), c = await f.context(), page = await c.newPage();
      page.setDefaultTimeout(10000);
      const namespace = role === 'master' ? 'master' : 'gym';
      const prefix = role === 'master' ? '/master' : '/g/a/admin';
      const input = role === 'master' ? '#master-code' : '#admin-code';
      await page.goto(f.base + (role === 'master' ? '/master' : '/g/a#admin'));
      async function unlock(value) { await page.locator(input).fill(value); await page.locator('#unlock-btn').click(); }
      await unlock('wrong');
      await page.getByText('Mật khẩu không đúng. Vui lòng thử lại.', { exact: true }).waitFor();
      await unlock(password(role));
      await page.locator('#session-controls').waitFor({ state: 'visible' });
      const oldCookie = (await c.cookies()).find(cookie => cookie.name === `gvg_${namespace}_session`);
      assert.ok(oldCookie.httpOnly); assert.equal(oldCookie.sameSite, 'Lax');
      assert.equal(await page.locator(input).inputValue(), '');
      assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
      await page.reload(); await page.locator('#session-controls').waitFor({ state: 'visible' });
      if (role === 'master') { await page.locator('[data-tab="gyms"]').click(); await page.locator('#gym-name').fill('Expired write'); }
      else await page.locator('.nm-name').first().fill('Expired write');
      const before = f.snapshot();
      f.advance(TTL[namespace][expiry] + 1);
      // For absolute expiry, keep idle alive to prove the independent absolute bound.
      if (expiry === 'absolute') f.db.prepare('UPDATE auth_sessions SET idle_expires_at=?').run(Date.now() + 7 * 86400000);
      await page.locator(role === 'master' ? '#gym-submit' : '#save-new-members').click();
      await page.locator('#lock-box').waitFor({ state: 'visible' });
      assert.match(await page.locator('#lock-msg').textContent(), /Phiên đã hết hạn/);
      assert.deepEqual(f.snapshot(), before);
      await unlock(password(role)); await page.locator('#session-controls').waitFor({ state: 'visible' });
      const fresh = (await c.cookies()).find(cookie => cookie.name === oldCookie.name);
      assert.notEqual(fresh.value, oldCookie.value);
      const replay = await f.context(); await replay.addCookies([oldCookie]);
      assert.equal((await f.request(replay, prefix + '/auth/session')).status(), 401);
      await page.locator('#logout-btn').click(); await page.locator('#lock-box').waitFor({ state: 'visible' });
      await page.reload(); await page.locator('#lock-box').waitFor({ state: 'visible' });
      await replay.addCookies([fresh]);
      assert.equal((await f.request(replay, prefix + '/auth/session')).status(), 401);
      assert.equal((await f.request(c, prefix + '/auth/session')).status(), 401);
    });
  }

  await t.test('Gym A cannot read/write Gym B or Master; foreign object IDs are isolated', async t => {
    const f = await fixture(t, browser), a = await f.context(), b = await f.context();
    const ah = await f.login(a, 'a'), bh = await f.login(b, 'b');
    assert.equal((await f.request(b, '/g/b/admin/entries', 'POST', { member_id: 2, map_id: 1, tickets_used: 1, points_scored: 10 }, bh)).status(), 200);
    const entry = f.db.prepare('SELECT id FROM entries WHERE gym_season_id=2').get().id;
    const before = f.snapshot();
    for (const [route, method, body, status] of [
      ['/g/b/admin/members', 'GET', undefined, 403], ['/g/b/admin/entries', 'GET', undefined, 403],
      ['/g/b/admin/members/bulk', 'POST', { members: [{ name: 'Intruder' }] }, 403],
      ['/master/gyms', 'GET', undefined, 401], ['/master/gyms/2/delete', 'PATCH', {}, 401],
      ['/g/a/admin/members/2', 'PATCH', { name: 'Intruder' }, 404],
      ['/g/a/admin/members/2/ban', 'PATCH', { is_banned: true }, 404],
      [`/g/a/admin/entries/${entry}`, 'PATCH', { points_scored: 20, tickets_used: 1 }, 404],
      [`/g/a/admin/entries/${entry}`, 'DELETE', undefined, 404],
      ['/g/a/admin/entries', 'POST', { member_id: 2, map_id: 1, tickets_used: 1, points_scored: 10 }, 404],
    ]) assert.equal((await f.request(a, route, method, body, ah)).status(), status, `${method} ${route}`);
    assert.deepEqual(f.snapshot(), before);
    const page = await a.newPage(); await page.goto(f.base + '/g/b#admin');
    await page.getByText(/Bạn không có quyền thực hiện/).waitFor();
    assert.equal(await page.locator('#panel').isVisible(), false);
    assert.equal((await f.request(a, '/g/a/admin/members/1', 'PATCH', { name: 'Allowed' }, ah)).status(), 200);
    assert.equal(f.db.prepare('SELECT name FROM members WHERE id=1').get().name, 'Allowed');
  });

  await t.test('public access denied for every current business admin route and auth mutation', async t => {
    const f = await fixture(t, browser), c = await f.context(), before = f.snapshot();
    assert.equal((await f.request(c, '/g/a/state')).status(), 200);
    const master = [['GET','season-templates'],['GET','season-templates/1'],['POST','season-templates'],['PATCH','season-templates/1'],['PATCH','season-templates/1/activate'],['GET','gyms'],['GET','gyms/check-slug'],['POST','gyms'],['PATCH','gyms/1/slug'],['PATCH','gyms/1/delete'],['PATCH','gyms/1/restore'],['GET','gym-requests'],['POST','map-images'],['POST','gyms/1/admin-password/reset'],['GET','auth/session'],['POST','auth/change-password']];
    const gym = [['GET','members'],['POST','members/bulk'],['PATCH','members/1'],['PATCH','members/1/ban'],['GET','entries'],['POST','entries'],['PATCH','entries/1'],['DELETE','entries/1'],['GET','season-switch/preview'],['POST','season-switch'],['GET','auth/session'],['POST','auth/change-password']];
    for (const [prefix, routes] of [['/master/', master], ['/g/a/admin/', gym]]) for (const [method, route] of routes) {
      assert.equal((await f.request(c, prefix + route, method, method === 'GET' ? undefined : {}, { 'X-CSRF-Token': 'forged', 'X-Admin-Code': password('a'), 'X-Master-Admin-Code': password('master') })).status(), 401, `${method} ${prefix}${route}`);
    }
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(fs.readdirSync(f.directory), []);
  });

  await t.test('CSRF missing/wrong/cross-session token and foreign/missing Origin fail without writes', async t => {
    const f = await fixture(t, browser);
    for (const role of ['master', 'a']) {
      const c = await f.context(), other = await f.context(), h = await f.login(c, role), foreign = await f.login(other, role);
      const route = role === 'master' ? '/master/gyms/2/delete' : '/g/a/admin/members/1/ban';
      const before = f.snapshot();
      for (const headers of [{}, { 'X-CSRF-Token': 'wrong' }, foreign, { ...h, Origin: 'https://attacker.invalid' }, { ...h, Origin: '' }]) {
        assert.equal((await f.request(c, route, 'PATCH', { is_banned: true }, headers)).status(), 403);
      }
      const prefix = role === 'master' ? '/master' : '/g/a/admin';
      assert.equal((await f.request(c, prefix + '/auth/logout', 'POST', {}, {})).status(), 403);
      assert.equal((await f.request(c, prefix + '/auth/session')).status(), 200);
      assert.deepEqual(f.snapshot(), before);
      assert.equal((await f.request(c, route, 'PATCH', { is_banned: true }, h)).status(), 200);
    }
  });

  await t.test('stored XSS travels through real API/database to Gym, Dashboard and Master DOM', async t => {
    const f = await fixture(t, browser), c = await f.context(), h = await f.login(c, 'a');
    assert.equal((await f.request(c, '/g/a/admin/members/1', 'PATCH', { name: payload }, h)).status(), 200);
    assert.equal(f.db.prepare('SELECT name FROM members WHERE id=1').get().name, payload);
    const beforeRejectedUrl = f.snapshot();
    assert.equal((await f.request(c, '/g/a/admin/members/1', 'PATCH', { avatar_url: 'javascript:window.__p22=1' }, h)).status(), 400);
    assert.deepEqual(f.snapshot(), beforeRejectedUrl);
    // Legacy stored gym names have no rename API; seed only this isolated DB.
    f.db.prepare('UPDATE gyms SET name=? WHERE id=1').run(payload);
    await f.login(c, 'master');
    for (const url of ['/g/a#admin', '/g/a', '/master']) {
      const page = await c.newPage(); page.setDefaultTimeout(10000);
      await page.goto(f.base + url);
      let rendered;
      if (url === '/master') {
        await page.locator('#session-controls').waitFor({ state: 'visible' });
        await page.locator('[data-tab="gyms"]').click();
        rendered = page.locator('#gym-list .list-row[data-id="1"] > span').first();
      } else if (url.endsWith('#admin')) {
        await page.locator('#session-controls').waitFor({ state: 'visible' });
        await page.locator('[data-admin-tab="members"]').click();
        rendered = page.locator('#member-list .list-row[data-id="1"] .member-inline > span');
      } else {
        rendered = page.locator('#gym-name');
      }
      await rendered.waitFor({ state: 'visible' });
      await page.waitForFunction(({ selector, text }) =>
        document.querySelector(selector)?.textContent.includes(text), {
        selector: url === '/master' ? '#gym-list .list-row[data-id="1"]' :
          url.endsWith('#admin') ? '#member-list .list-row[data-id="1"]' : '#gym-name', text: payload,
      });
      assert.ok((await rendered.textContent()).includes(payload), `${url}: literal stored payload rendered`);
      assert.equal(await page.evaluate(() => window.__p22), 0);
      assert.equal(await page.locator('[onerror], [onload], img[src="x"]').count(), 0);
      await page.close();
    }
  });

  await t.test('brute force blocks correct password, honors Retry-After and recovers after window', async t => {
    const f = await fixture(t, browser);
    for (const role of ['master', 'a']) {
      const c = await f.context(), prefix = role === 'master' ? '/master' : '/g/a/admin';
      for (let i = 0; i < 5; i++) assert.equal((await f.request(c, prefix + '/auth/login', 'POST', { password: 'wrong' }, { 'X-Forwarded-For': `192.0.2.${i+1}` })).status(), 401);
      const r = await f.request(c, prefix + '/auth/login', 'POST', { password: password(role) });
      assert.equal(r.status(), 429); assert.ok(Number(r.headers()['retry-after']) > 0);
      assert.equal((await f.request(c, prefix + '/auth/session')).status(), 401);
      f.advance(16 * 60000); await f.login(c, role);
    }
  });

  await t.test('fake uploads leave no files; valid image persists and upload budget returns 429', async t => {
    const f = await fixture(t, browser), c = await f.context(), h = await f.login(c, 'master');
    const headers = { ...h, 'Content-Type': 'image/png', 'X-Filename': '../../fake.png' };
    for (const fake of [Buffer.from('<svg onload="alert(1)"/>'), Buffer.from('not a png'), Buffer.concat([png.subarray(0, 8), Buffer.from('fake')])]) {
      assert.equal((await f.request(c, '/master/map-images', 'POST', fake, headers)).status(), 400);
      assert.deepEqual(fs.readdirSync(f.directory), []);
    }
    const valid = await f.request(c, '/master/map-images', 'POST', png, headers);
    assert.equal(valid.status(), 200);
    const url = (await valid.json()).image_url;
    assert.match(url, /^\/uploads\/map-images\/[a-f0-9-]+\.png$/);
    const served = await f.request(c, url); assert.equal(served.status(), 200);
    assert.equal(served.headers()['content-type'], 'image/png');
    for (let i = 4; i < 10; i++) assert.equal((await f.request(c, '/master/map-images', 'POST', Buffer.from('fake'), headers)).status(), 400);
    const blocked = await f.request(c, '/master/map-images', 'POST', png, headers);
    assert.equal(blocked.status(), 429); assert.ok(Number(blocked.headers()['retry-after']) > 0);
    assert.equal(fs.readdirSync(f.directory).length, 1);
  });

  await t.test('404, malformed JSON and real database failure disclose no internals', async t => {
    const f = await fixture(t, browser), c = await f.context();
    async function check(response, status) {
      assert.equal(response.status(), status);
      const text = await response.text(), body = JSON.parse(text);
      assert.deepEqual(Object.keys(body).sort(), ['code', 'error', 'request_id']);
      assert.equal(body.request_id, response.headers()['x-request-id']);
      assert.doesNotMatch(text, /SQLITE|SELECT|stack|secret-canary|node_modules|[A-Z]:\\/i);
    }
    await check(await f.request(c, '/g/missing/state'), 404);
    await check(await f.request(c, '/master/auth/login', 'POST', '{"password":"secret-canary"', { 'Content-Type': 'application/json' }), 400);
    f.db.exec('ALTER TABLE gyms RENAME TO p22_unavailable');
    await check(await f.request(c, '/g/a/state'), 500);
  });
});

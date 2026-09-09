const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { securityHeaders, imageOrigins } = require('../security/headers');

test('P11 strict origin configuration rejects CSP injection and broad sources', () => {
  for (const v of ['*', 'https:', 'https://*.example.com', 'http://images.example.com', 'https://a.test/path', 'https://user:pass@a.test', 'https://a.test;script-src *']) {
    assert.throws(() => imageOrigins(v), /SECURITY_CONFIG/);
  }
  assert.deepEqual(imageOrigins('https://images.example.com, https://images.example.com'), ['https://images.example.com']);
});

test('P11 headers cover success, static, errors and redirects; HSTS trusts only HTTPS production', async () => {
  for (const production of [false, true]) for (const trusted of [false, true]) {
    const app = express();
    app.set('trust proxy', trusted ? 'loopback' : false);
    app.use(securityHeaders({ NODE_ENV: production ? 'production' : 'development' }));
    app.get('/redirect', (req, res) => res.redirect('/ok'));
    app.get('/error', (req, res) => res.status(413).json({ error: 'large' }));
    app.use(express.static(require('node:path').join(__dirname, '../public')));
    app.use((req, res) => res.status(404).end());
    const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
    try {
      for (const proto of ['http', 'https']) for (const url of ['/', '/style.css', '/redirect', '/error', '/missing']) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { redirect: 'manual', headers: { 'X-Forwarded-Proto': proto } });
        assert.equal(response.headers.get('strict-transport-security'), production && trusted && proto === 'https' ? 'max-age=31536000' : null);
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(response.headers.get('x-frame-options'), 'DENY');
        assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
        assert.match(response.headers.get('permissions-policy'), /camera=\(\)/);
        const csp = response.headers.get('content-security-policy');
        assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /script-src 'self'; script-src-attr 'none'/);
        assert.ok(!csp.includes('*') && !csp.includes('unsafe-eval'));
        await response.arrayBuffer();
      }
    } finally { await new Promise(r => server.close(r)); }
  }
});

test('P11 all HTML pages and tabs render with enforced CSP, same geometry and blocked injection', { timeout: 120000 }, async () => {
  const { chromium } = require('playwright');
  const { createDb } = require('../db');
  const db = createDb(':memory:');
  db.prepare('INSERT INTO gyms(name,slug,admin_code) VALUES (?,?,?)').run('CSP Gym', 'csp', 'fixture-password');
  db.exec(`INSERT INTO season_templates(id,name,is_active,last_defined_round_number,battle_start_at,ticket_day1_amount,ticket_daily_amount,ticket_regen_days)
    VALUES (1,'CSP season',1,1,'2026-01-01',10,1,1);
    INSERT INTO season_template_maps(id,season_template_id,name,order_index,image_url) VALUES (1,1,'Map',1,'/assets/pokemon-types/fire.svg');
    INSERT INTO season_template_rounds(season_template_id,round_number,max_score,order_index) VALUES (1,1,100,1);
    INSERT INTO gym_seasons(id,gym_id,season_template_id) VALUES (1,1,1);
    INSERT INTO members(gym_season_id,name,avatar_url) VALUES (1,'Member','/assets/pokemon-types/water.svg');`);
  require('../engine').recomputeRoundChain(db, 1);
  await require('../auth/migrate').migrateCredentials(db, { env: { MASTER_ADMIN_CODE: 'fixture-master-password' } });
  const app = require('../server').createApp(db, { env: { SESSION_SECRETS: 's'.repeat(32), AUTH_RATE_LIMIT_SECRET: 'r'.repeat(32) } });
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) });
    const context = await browser.newContext();
    // Network-independent font fixture: Google stylesheet source is still checked by CSP.
    await context.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await context.addInitScript(() => { window.cspViolations = []; document.addEventListener('securitypolicyviolation', e => window.cspViolations.push(e.effectiveDirective)); });
    for (const width of [390, 768, 1440]) for (const url of ['/', '/index.html', '/master', '/master.html', '/g/csp', '/dashboard.html', '/admin.html', '/g/csp/admin']) {
      const layouts = [];
      for (const enabled of [false, true]) {
        const page = await context.newPage(); await page.setViewportSize({ width, height: 900 });
        if (!enabled) await page.route(base + '/**', async route => { const response = await route.fetch({ maxRedirects: 0 }); const headers = response.headers(); delete headers['content-security-policy']; await route.fulfill({ response, headers }); });
        await page.goto(base + url); await page.waitForLoadState('networkidle');
        layouts.push(await page.locator('body').evaluate(body => [...body.querySelectorAll('*')].filter(e => e.getBoundingClientRect().width).map(e => {
          const r = e.getBoundingClientRect(), s = getComputedStyle(e); return [e.tagName, e.id, r.x, r.y, r.width, r.height, s.fontFamily, s.color, s.backgroundColor];
        })));
        if (enabled) {
          for (const tab of await page.locator('.tab-btn:visible').all()) { await tab.click(); await page.waitForLoadState('networkidle'); }
          assert.deepEqual(await page.evaluate(() => window.cspViolations), [], `${url}/${width}`);
        }
        await page.close();
      }
      assert.deepEqual(layouts[1], layouts[0], `CSP changed layout ${url}/${width}`);
    }
    const page = await context.newPage(); await page.goto(base);
    await page.locator('#go-btn').click(); assert.match(await page.locator('#err-msg').textContent(), /Vui lòng/);
    await page.locator('#slug-input').fill('csp'); await page.locator('#slug-input').press('Enter'); await page.waitForURL(base + '/g/csp');
    for (const [url, id, password] of [['/master', 'master-code', 'fixture-master-password'], ['/g/csp#admin', 'admin-code', 'fixture-password']]) {
      await page.goto(base + url); await page.locator('#' + id).fill(password); await page.locator('#unlock-btn').click();
      await page.locator('#panel').waitFor({ state: 'visible' }); await page.waitForLoadState('networkidle');
      for (const tab of await page.locator('.tab-btn:visible').all()) { await tab.click(); await page.waitForLoadState('networkidle'); }
      if (id === 'admin-code') for (const tab of await page.locator('#admin-tabs .tab-btn').all()) { await tab.click(); await page.waitForLoadState('networkidle'); }
      assert.deepEqual(await page.evaluate(() => window.cspViolations), [], `authenticated ${id}`);
    }
    await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.injected = true'; document.body.append(s); const img = new Image(); img.src = 'https://unapproved.invalid/a.png'; document.body.append(img); });
    await page.waitForFunction(() => window.cspViolations.includes('script-src-elem') && window.cspViolations.includes('img-src'));
    assert.equal(await page.evaluate(() => window.injected), undefined);
    // Check bundled SVG styles as standalone documents, where their own CSP applies.
    for (const file of require('node:fs').readdirSync(require('node:path').join(__dirname, '../public/assets/pokemon-types')).filter(f => f.endsWith('.svg'))) {
      await page.goto(base + '/assets/pokemon-types/' + file);
      assert.notEqual(await page.locator('.cls-2').first().evaluate(e => getComputedStyle(e).fill), 'rgb(0, 0, 0)', file);
    }
    await context.close();
  } finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); db.close(); }
});



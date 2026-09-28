const { suiteTest } = require('./visual-suite-mode');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const artifacts = path.join(root, 'tmp/p08');
const payload = '\"><img src=x onerror="window.__xss=1"><svg onload="window.__xss=1">&\'';
const attr = '\" autofocus onfocus="window.__xss=1" data-pwn="';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const image = '/assets/pokemon-types/fire.svg';
function fixture(name = 'Summer', url = image) {
  const season = { id: 1, name, is_active: 1, gym_count: 0, battle_start_at: '2026-01-01T00:00:00Z', ticket_day1_amount: 12, ticket_daily_amount: 3, ticket_regen_days: 6 };
  return { seasons: [season], gyms: [{ id: 1, name, slug: 'gym' }], requests: [{ gym_name: name, desired_slug: 'gym', contact_info: 'Contact' }], detail: { season, maps: [{ id: 1, name, image_url: url, note: 'Note', type_weakness: 'fire' }], rounds: [{ round_number: 1, max_score: 100 }] } };
}
async function setup(browser, data = fixture(), source = read('public/master.js')) {
  const page = await browser.newPage(); page.setDefaultTimeout(7000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.__xss = 0; });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/master') return route.fulfill({ contentType: 'text/html', body: read('public/master.html') });
    if (url.pathname === '/master.js') return route.fulfill({ contentType: 'text/javascript', body: source });
    if (url.pathname === '/master/auth/session') return route.fulfill({ json: { csrf_token: 'fixture-csrf' } });
    const json = { '/master/season-templates': data.seasons, '/master/gyms': data.gyms, '/master/gym-requests': data.requests, '/master/season-templates/1': data.detail }[url.pathname];
    if (json) return route.fulfill({ json });
    if (url.origin === 'http://master.test' && fs.existsSync(path.join(root, 'public', url.pathname))) return route.fulfill({ path: path.join(root, 'public', url.pathname) });
    return route.abort();
  });
  await page.goto('http://master.test/master');
  await page.locator('#dashboard-summary .list-row').first().waitFor();
  return { page, errors };
}
async function safe(page) {
  assert.equal(await page.evaluate(() => window.__xss), 0);
  assert.equal(await page.locator('svg, [onerror], [onload], [onfocus], [autofocus], [data-pwn], script:not([src])').count(), 0);
}
async function edit(page) {
  await page.locator('[data-tab="seasons"]').click();
  const previous = await page.locator('.map-name').first().elementHandle();
  await page.locator('.st-edit').first().click();
  await page.waitForFunction(el => !el.isConnected, previous);
  await previous.dispose();
  await page.locator('#st-cancel-edit').waitFor({ state: 'visible' });
}
async function setPng(page, name = 'map.png') {
  await page.locator('.map-image-file').first().setInputFiles({ name, mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => document.querySelector('.map-image-preview img')?.src.startsWith('data:image/png;'));
}

test('P08 Master Admin XSS, upload and template regression', { timeout: 180000 }, async t => {
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) });
  try {
    await suiteTest(t, 'escape, HTTP URLs and separate local raster data URL policy', async () => {
      const { page } = await setup(browser);
      try {
        const values = [payload, attr, '&lt;img&gt;', '` & < > " \'', '', null];
        const result = await page.evaluate(values => ({
          texts: values.map(v => { const el = document.createElement('div'); el.innerHTML = '<span title="' + masterEscape(v) + '">' + masterEscape(v) + '</span>'; return [el.textContent, el.firstChild.title, el.childElementCount]; }),
          bad: ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:image/png;base64,AAAA', 'data:text/html,<svg>', 'data:image/svg+xml,<svg>', 'blob:https://x/id', 'file:///x', 'https://x/" onerror="x', '\\\\x/a', '//user:pass@x/a', ' https://x/a', 'https://[bad', 'https://x/\u0000a', null].map(masterHttpUrl),
          good: ['/uploads/map.png', 'map.jpg', 'https://example.com/a?x=1&y=2', 'http://example.com/a.jpg'].map(masterHttpUrl),
          dataBad: ['data:text/html;base64,AAAA', 'data:image/svg+xml;base64,AAAA', 'data:image/png,<svg>', 'data:image/png;base64,AAAA" onerror="x', 'data:image/png;base64,AAAA\n', 'data:image/png;base64,', null].map(masterRasterPreviewUrl),
          dataGood: ['data:image/png;base64,AAAA', 'data:image/jpeg;base64,AA=='].map(masterRasterPreviewUrl),
        }), values);
        assert.deepEqual(result.texts, values.map(v => [v ?? '', v ?? '', 1]));
        assert.ok(result.bad.every(v => v === '')); assert.ok(result.good.every(Boolean));
        assert.ok(result.dataBad.every(v => v === '')); assert.ok(result.dataGood.every(Boolean));
      } finally { await page.close(); }
    });

    await suiteTest(t, 'API Gym/season/request names and Map/Round attributes are literal', async () => {
      for (const attack of [payload, attr]) {
        const data = fixture(attack, attack);
        data.seasons[0].gym_count = attack;
        data.gyms[0].id = attack; data.gyms[0].slug = attack;
        data.requests[0].desired_slug = attack; data.requests[0].contact_info = attack;
        data.detail.maps[0].id = attack; data.detail.maps[0].note = attack; data.detail.maps[0].type_weakness = attack;
        data.detail.rounds[0] = { round_number: attack, max_score: attack };
        const { page, errors } = await setup(browser, data);
        try {
          assert.equal(await page.locator('#dashboard-summary .sub').first().textContent(), attack);
          await edit(page);
          assert.equal(await page.locator('#st-name').inputValue(), attack);
          assert.equal(await page.locator('.map-name').inputValue(), attack);
          assert.equal(await page.locator('.map-note').inputValue(), attack);
          assert.equal(await page.locator('.map-image').inputValue(), attack);
          assert.equal(await page.locator('.map-id').inputValue(), attack);
          assert.equal(await page.locator('.map-type').inputValue(), '');
          assert.equal(await page.locator('.round-max').getAttribute('value'), attack);
          assert.equal(await page.locator('.round-number-label').textContent(), 'Round 1');
          assert.equal(await page.locator('.map-image-preview img').count(), 0);
          await page.locator('[data-tab="gyms"]').click(); await page.locator('.gym-rename').waitFor();
          assert.equal(await page.locator('#gym-list .list-row').getAttribute('data-id'), attack);
          assert.ok((await page.locator('#gym-list').textContent()).includes(attack));
          await page.locator('[data-tab="requests"]').click(); await page.locator('#request-list .list-row').waitFor();
          assert.equal(await page.locator('#request-list .list-row > .sub').textContent(), attack);
          await safe(page); assert.deepEqual(errors, []);
        } finally { await page.close(); }
      }
    });

    await suiteTest(t, 'persisted preview URLs and created Gym links reject executable schemes', async () => {
      for (const url of ['javascript:alert(1)', 'data:text/html,<script>window.__xss=1</script>', 'data:image/svg+xml,<svg onload="window.__xss=1">', 'x" onerror="window.__xss=1', image]) {
        const { page } = await setup(browser, fixture('Summer', url));
        try {
          await edit(page);
          assert.equal(await page.locator('.map-image-preview img').count(), url === image ? 1 : 0);
          if (url === image) assert.equal(await page.locator('.map-image-preview img').evaluate(img => img.decode().then(() => img.naturalWidth > 0)), true);
          await page.route('**/master/gyms', route => route.request().method() === 'POST' ? route.fulfill({ json: { gym: { dashboard_url: url, admin_url: url, admin_code: payload } } }) : route.fallback());
          await page.locator('[data-tab="gyms"]').click(); await page.locator('#gym-name').fill('Test'); await page.locator('#gym-submit').click();
          await page.locator('#gym-created-box').waitFor({ state: 'visible' });
          for (const id of ['gym-created-dashboard', 'gym-created-admin']) {
            assert.equal(await page.locator('#' + id).textContent(), url);
            assert.equal(!!await page.locator('#' + id).getAttribute('href'), url === image);
          }
          assert.equal(await page.locator('#gym-created-code').textContent(), payload);
          await safe(page);
        } finally { await page.close(); }
      }
    });

    await suiteTest(t, 'all list/API errors remain text, including upload and template failures', async () => {
      const { page } = await setup(browser);
      try {
        await page.route('**/master/**', route => route.fulfill({ status: 400, json: { error: payload } }));
        for (const [tab, box] of [['dashboard', 'dashboard-summary'], ['seasons', 'season-list'], ['gyms', 'gym-list'], ['requests', 'request-list']]) {
          await page.locator(`[data-tab="${tab}"]`).click();
          await page.locator(`#${box} .error`).waitFor(); assert.equal(await page.locator('#' + box).textContent(), '⚠️ ' + payload);
        }
        await page.evaluate(() => startEditSeason(1)); assert.equal(await page.locator('#st-msg').textContent(), '⚠️ ' + payload);
        await page.locator('[data-tab="gyms"]').click(); await page.locator('#gym-name').fill('Gym'); await page.locator('#gym-submit').click();
        await page.waitForFunction(() => document.querySelector('#gym-msg').classList.contains('error'));
        assert.equal(await page.locator('#gym-msg').textContent(), '⚠️ ' + payload);
        await page.locator('[data-tab="seasons"]').click();
        await page.locator('#st-name').fill('Season'); await page.locator('.map-name').first().fill('Map');
        await page.locator('.round-max').fill('100'); await page.locator('#st-battle-start').fill('2026-01-01T07:00');
        await setPng(page); await page.locator('#st-submit').click();
        await page.waitForFunction(() => document.querySelector('#st-msg').textContent.startsWith('⚠️'));
        assert.equal(await page.locator('#st-msg').textContent(), '⚠️ ' + payload);
        await page.locator('.map-image-clear').first().click(); await page.locator('#st-submit').click();
        await page.waitForFunction(() => document.querySelector('#st-msg').textContent.startsWith('⚠️'));
        assert.equal(await page.locator('#st-msg').textContent(), '⚠️ ' + payload); await safe(page);
      } finally { await page.close(); }
    });

    await suiteTest(t, 'PNG/JPEG preview, hostile filename, clear, invalid files and stale reads', async () => {
      const { page, errors } = await setup(browser);
      try {
        await edit(page); await setPng(page, payload + '.png');
        assert.equal(await page.locator('.map-image-status').textContent(), payload + '.png');
        assert.equal(await page.locator('.map-image-preview img').evaluate(img => img.decode().then(() => img.naturalWidth)), 1);
        const jpeg = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 2; return c.toDataURL('image/jpeg').split(',')[1]; });
        await page.locator('.map-image-file').setInputFiles({ name: 'map.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
        await page.waitForFunction(() => document.querySelector('.map-image-preview img')?.src.startsWith('data:image/jpeg;'));
        await page.locator('.map-image-preview img').evaluate(img => img.decode());
        await page.locator('.map-image-clear').click();
        assert.equal(await page.locator('.map-image').inputValue(), ''); assert.equal(await page.locator('.map-image-preview img').count(), 0);
        await page.locator('.map-image-file').setInputFiles({ name: 'evil.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg onload="window.__xss=1"/>') });
        assert.equal(await page.locator('.map-image-status').textContent(), 'Chỉ chấp nhận PNG hoặc JPEG');
        await page.locator('.map-image-file').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
        assert.equal(await page.locator('.map-image-status').textContent(), 'Ảnh vượt quá 5 MB');
        await page.evaluate(() => { window.FileReader = class { readAsDataURL() { window.pendingReader = this; } }; });
        await page.locator('.map-image-file').setInputFiles({ name: 'pending.png', mimeType: 'image/png', buffer: png });
        await page.locator('.map-image-clear').click();
        await page.evaluate(() => { window.pendingReader.result = 'data:image/png;base64,AAAA'; window.pendingReader.onload(); });
        assert.equal(await page.locator('.map-image-preview img').count(), 0);
        await safe(page); assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });

    await suiteTest(t, 'unsafe upload response cannot be saved as template image', async () => {
      const { page } = await setup(browser); let saved = 0;
      try {
        await page.route('**/master/map-images', route => route.fulfill({ json: { image_url: 'data:image/svg+xml,<svg onload=alert(1)>' } }));
        await page.route('**/master/season-templates/1', route => { if (route.request().method() === 'PATCH') { saved++; return route.fulfill({ json: {} }); } return route.fallback(); });
        await edit(page); await setPng(page); await page.locator('#st-submit').click();
        await page.waitForFunction(() => document.querySelector('#st-msg').textContent.includes('URL ảnh'));
        assert.equal(saved, 0); await safe(page);
      } finally { await page.close(); }
    });

    await suiteTest(t, 'before/after Master responsive screenshots', { skip: !fs.existsSync(path.join(artifacts, 'master-before.js')) && 'Requires local pre-edit baseline' }, async () => {
      const before = await setup(browser, fixture(), fs.readFileSync(path.join(artifacts, 'master-before.js'), 'utf8'));
      const after = await setup(browser);
      for (const { page } of [before, after]) await page.evaluate(() => {
        const scrollIntoView = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (options) { scrollIntoView.call(this, { ...options, behavior: 'instant' }); };
      });
      try {
        for (const width of [390, 768, 1440]) for (const view of ['dashboard', 'edit', 'preview', 'gyms', 'requests']) {
          const shots = [];
          const layouts = [];
          for (const [label, { page }] of [['before', before], ['after', after]]) {
            await page.setViewportSize({ width, height: 900 });
            if (view === 'edit' || view === 'preview') { await edit(page); if (view === 'preview') await setPng(page); }
            else { await page.locator(`[data-tab="${view}"]`).click(); await page.locator('#tab-' + view + ' .list-row').first().waitFor(); }
            await page.evaluate(async () => { await Promise.all([...document.images].map(img => img.decode().catch(() => {}))); window.scrollTo({ top: 0, behavior: 'instant' }); document.getAnimations().forEach(animation => animation.finish()); });
            layouts.push(await page.evaluate(() => [...document.querySelectorAll('body *')]
              .filter(el => el.getClientRects().length)
              .map(el => { const r = el.getBoundingClientRect(); return [el.tagName, el.id, el.className, ...[r.x + scrollX, r.y + scrollY, r.width, r.height].map(n => Math.round(n * 1000) / 1000)]; })));
            shots.push(await page.screenshot({ path: path.join(artifacts, `${label}-${width}-${view}.png`), fullPage: true, animations: 'disabled' }));
          }
          assert.deepEqual(layouts[0], layouts[1], `Layout changed: ${width}/${view}`);
          // Chromium may round a gradient channel by 1/255 between captures.
          // Compare decoded pixels (not PNG bytes), with exact element geometry above.
          const comparison = await after.page.evaluate(async urls => {
            const frames = await Promise.all(urls.map(async src => {
              const img = new Image(); img.src = src; await img.decode();
              const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
              const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
              return { width: img.width, height: img.height, pixels: ctx.getImageData(0, 0, img.width, img.height).data };
            }));
            let maxDelta = 0, changedPixels = 0;
            for (let i = 0; i < frames[0].pixels.length; i += 4) {
              const delta = Math.max(...[0, 1, 2, 3].map(j => Math.abs(frames[0].pixels[i + j] - frames[1].pixels[i + j])));
              maxDelta = Math.max(maxDelta, delta); if (delta) changedPixels++;
            }
            return { dimensions: frames.map(f => [f.width, f.height]), maxDelta, changedPixels };
          }, shots.map(buffer => 'data:image/png;base64,' + buffer.toString('base64')));
          fs.writeFileSync(path.join(artifacts, `comparison-${width}-${view}.json`), JSON.stringify(comparison));
          assert.deepEqual(comparison.dimensions[0], comparison.dimensions[1]);
          assert.ok(comparison.maxDelta <= 1, `Visual change: ${width}/${view}: ${JSON.stringify(comparison)}`);
        }
      } finally { await before.page.close(); await after.page.close(); }
    });

    await suiteTest(t, 'real session/API/SQLite: upload PNG/JPEG and create/edit template without losing IDs or text', async () => {
      const { createDb } = require('../db'); const { createApp } = require('../server');
      const db = createDb(':memory:'); const password = 'master browser test password';
      db.prepare("INSERT INTO auth_principals(role,password_hash,must_rotate) VALUES ('master',?,0)").run(await require('../auth/password').hashPassword(password));
      const app = createApp(db, { env: { SESSION_SECRETS: 's'.repeat(32), AUTH_RATE_LIMIT_SECRET: 'r'.repeat(32) } });
      const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const context = await browser.newContext(); await context.route('https://fonts.googleapis.com/**', route => route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(7000);
      const snapshots = new Set(), uploads = new Set(), mutations = [], errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (['POST', 'PATCH'].includes(r.method())) mutations.push({ url: r.url(), csrf: r.headers()['x-csrf-token'] }); });
      await page.addInitScript(() => { window.__xss = 0; });
      await page.addInitScript(() => { window.cspViolations = []; document.addEventListener('securitypolicyviolation', e => window.cspViolations.push(e.effectiveDirective)); });
      const seasonName = 'P08-' + randomUUID() + payload;
      async function save() {
        const response = page.waitForResponse(r => /\/master\/season-templates(?:\/\d+)?$/.test(r.url()) && ['POST', 'PATCH'].includes(r.request().method()));
        await page.locator('#st-submit').click(); const res = await response; const data = await res.json();
        assert.equal(res.status(), 200, JSON.stringify(data)); if (data.snapshot_file) snapshots.add(data.snapshot_file);
        await page.locator('.st-edit').waitFor();
      }
      async function uploadAndSave() {
        const uploaded = page.waitForResponse(r => r.url().endsWith('/master/map-images'));
        const saved = save(); const response = await uploaded; const result = await response.json();
        assert.equal(response.status(), 200); uploads.add(result.image_url); await saved; return result.image_url;
      }
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/master`);
        await page.locator('#master-code').fill(password); await page.locator('#unlock-btn').click();
        await page.locator('#panel').waitFor({ state: 'visible' }); await page.locator('[data-tab="seasons"]').click();
        await page.locator('#st-name').fill(seasonName); await page.locator('.map-name').first().fill(payload);
        await page.locator('.map-note').first().fill(attr); await page.locator('.map-type').first().selectOption('fire');
        await page.locator('.round-max').fill('100'); await page.locator('#st-battle-start').fill('2026-01-01T07:00');
        await setPng(page); const pngUrl = await uploadAndSave(); assert.match(pngUrl, /\.png$/);
        const season = db.prepare('SELECT * FROM season_templates').get(); const map = db.prepare('SELECT * FROM season_template_maps').get();
        assert.equal(season.name, seasonName); assert.equal(map.name, payload); assert.equal(map.note, attr); assert.equal(map.image_url, pngUrl);
        await edit(page); await page.locator('.map-image-preview img').evaluate(img => img.decode());
        await page.locator('.map-name').fill(payload + ' edited'); await page.locator('#st-add-round').click(); await page.locator('.round-max').last().fill('200');
        const jpeg = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 2; return c.toDataURL('image/jpeg').split(',')[1]; });
        await page.locator('.map-image-file').setInputFiles({ name: 'edit.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
        await page.waitForFunction(() => document.querySelector('.map-image-preview img')?.src.startsWith('data:image/jpeg;'));
        const jpgUrl = await uploadAndSave(); assert.match(jpgUrl, /\.jpg$/);
        const edited = db.prepare('SELECT * FROM season_template_maps WHERE id=?').get(map.id);
        assert.equal(edited.name, payload + ' edited'); assert.equal(edited.image_url, jpgUrl); assert.equal(edited.note, attr);
        assert.equal(db.prepare('SELECT count(*) n FROM season_templates').get().n, 1); assert.equal(db.prepare('SELECT repeat_max_score FROM season_templates').get().repeat_max_score, 200);
        await edit(page); await page.locator('.map-image-clear').click(); await page.locator('.round-remove').last().click(); await save();
        assert.equal(db.prepare('SELECT image_url FROM season_template_maps WHERE id=?').get(map.id).image_url, '');
        assert.equal(db.prepare('SELECT repeat_max_score FROM season_templates').get().repeat_max_score, 100);
        await edit(page); await page.locator('.map-name').fill('unsaved'); await page.locator('#st-cancel-edit').click();
        assert.equal(db.prepare('SELECT name FROM season_template_maps WHERE id=?').get(map.id).name, payload + ' edited');
        const business = mutations.filter(m => !m.url.includes('/auth/')); assert.equal(business.length, 5); assert.ok(business.every(m => m.csrf));
        assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
        await safe(page); assert.deepEqual(errors, []);
      } finally {
        await context.close(); await new Promise(resolve => server.close(resolve)); db.close();
        // Delete only exact response filenames created by this isolated fixture; never recurse.
        for (const filename of snapshots) { assert.equal(path.basename(filename), filename); const p = path.join(root, 'season-configs', filename); if (fs.existsSync(p)) fs.unlinkSync(p); }
        for (const url of uploads) { assert.match(url, /^\/uploads\/map-images\/[\w.-]+\.(png|jpg)$/); const p = path.join(root, 'public', url); if (fs.existsSync(p)) fs.unlinkSync(p); }
      }
    });
  } finally { await browser.close(); }
});

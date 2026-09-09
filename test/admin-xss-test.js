const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const artifactDir = path.join(root, 'tmp/p07');
const payload = '<img src=x onerror="window.__xss=1"><svg onload="window.__xss=1">&\'"';
const attributePayload = '\" autofocus onfocus="window.__xss=1" data-pwn="';
const image = '/assets/pokemon-types/fire.svg';

function fixture(name = 'Alice', url = image) {
  return {
    state: { gym: { name: 'Gym' }, season: { name: 'Season' }, maps: [{ id: 1, name, image_url: url, type_weakness: 'fire', current_points: 20, round_progress_pct: 20 }], active_round: { round_number: 1, max_score: 100 } },
    overview: { maps: [], members: [], rounds: [], score_cells: [], ticket_cells: [] },
    members: [{ id: 1, name, avatar_url: url, is_banned: 0 }],
    entries: [{ id: 1, member_id: 1, season_template_map_id: 1, member_name: name, map_name: name, map_image: url, map_type: 'fire', round_number: 1, tickets_used: 1, points_scored: 20, created_at: '2026-09-07 00:00:00' }],
    preview: { hasNewSeason: true, newSeasonName: 'Next season', rosterToCopy: [{ name, avatar_url: url }] },
  };
}

async function setup(browser, data = fixture(), adminSource = read('public/admin.js')) {
  const page = await browser.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { Date.now = () => Date.parse('2026-09-07T00:00:00Z'); window.__xss = 0; });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/g/test') return route.fulfill({ contentType: 'text/html', body: read('public/dashboard.html') });
    if (url.pathname === '/admin.js') return route.fulfill({ contentType: 'text/javascript', body: adminSource });
    if (url.pathname.endsWith('/auth/session')) return route.fulfill({ json: { csrf_token: 'test-csrf' } });
    const key = url.pathname.split('/').pop();
    if (Object.hasOwn(data, key)) return route.fulfill({ json: data[key] });
    if (url.origin === 'http://admin.test' && fs.existsSync(path.join(root, 'public', url.pathname))) return route.fulfill({ path: path.join(root, 'public', url.pathname) });
    return route.abort();
  });
  await page.goto('http://admin.test/g/test#admin');
  await page.locator('#member-list .list-row').first().waitFor();
  await page.waitForFunction(() => document.querySelector('#admin-log-list .log-card'));
  return { page, errors };
}
async function safe(page) {
  assert.equal(await page.evaluate(() => window.__xss), 0);
  assert.equal(await page.locator('#tab-admin svg, #tab-admin script, #tab-admin [onerror], #tab-admin [onload], #tab-admin [onfocus], #tab-admin [autofocus], #tab-admin [data-pwn]').count(), 0);
}
async function entriesTab(page) { await page.locator('[data-admin-tab="entries"]').click(); }
async function membersTab(page) { await page.locator('[data-admin-tab="members"]').click(); }

test('P07 Gym Admin XSS and workflow regression', { timeout: 180000 }, async t => {
  fs.mkdirSync(artifactDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) });
  try {
    await t.test('escape roundtrips and image URL policy', async () => {
      const source = read('public/admin.js').replace('sessionClient.restore();', 'window.__adminTest = { escapeHtml, imageUrl }; sessionClient.restore();');
      const { page } = await setup(browser, fixture(), source);
      try {
        const values = [payload, attributePayload, '&lt;svg onload=alert(1)&gt;', '` & < > " \'', '', null];
        const result = await page.evaluate(values => {
          const { escapeHtml, imageUrl } = window.__adminTest;
          return {
            roundtrips: values.map(value => {
              const div = document.createElement('div');
              div.innerHTML = '<span title="' + escapeHtml(value) + '">' + escapeHtml(value) + '</span>';
              return [div.textContent, div.firstChild.title, div.childElementCount];
            }),
            bad: ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'data:image/svg+xml,<svg onload=alert(1)>', 'data:image/png;base64,AAAA', 'blob:https://x/id', 'file:///x', 'https://x/" onerror="alert(1)', '//user:pass@x/a', '\\\\x/a', 'https://[bad', ' https://x/a', 'https://x/\u0000a', '', null].map(imageUrl),
            good: ['/uploads/a.png', 'a.jpg', 'https://example.com/a?x=1&y=2', 'http://example.com/a.jpg'].map(imageUrl),
          };
        }, values);
        assert.deepEqual(result.roundtrips, values.map(v => [v ?? '', v ?? '', 1]));
        assert.ok(result.bad.every(v => v === '')); assert.ok(result.good.every(Boolean));
      } finally { await page.close(); }
    });

    await t.test('API names, IDs, numbers, filters, member editor and log cards cannot inject markup', async () => {
      for (const attack of [payload, attributePayload]) {
        const data = fixture(attack, attack);
        data.members[0].id = attack;
        data.state.maps[0].id = attack;
        data.entries[0] = { ...data.entries[0], id: attack, member_id: attack, season_template_map_id: attack, round_number: attack, tickets_used: attack, points_scored: attack, map_type: attack };
        data.preview.newSeasonName = attack;
        const { page, errors } = await setup(browser, data);
        try {
          assert.equal(await page.locator('.member-inline > span').first().textContent(), attack);
          assert.equal(await page.locator('.mem-name').inputValue(), attack);
          assert.equal(await page.locator('.mem-avatar').inputValue(), attack);
          assert.equal(await page.locator('#member-list .list-row').getAttribute('data-id'), attack);
          assert.equal(await page.locator('#entry-member option').textContent(), attack);
          assert.equal(await page.locator('#entry-map option').getAttribute('value'), attack);
          assert.equal(await page.locator('#new-season-name').textContent(), attack);
          await page.locator('.mem-edit').click();
          await page.locator('.mem-name').fill('draft'); await page.locator('.mem-cancel').click();
          assert.equal(await page.locator('.mem-name').inputValue(), attack);
          await entriesTab(page);
          assert.equal(await page.locator('.log-member-name').textContent(), attack + ' ');
          assert.ok((await page.locator('.log-time').textContent()).startsWith(attack));
          assert.equal(await page.locator('.log-view-row strong').textContent(), attack);
          assert.equal(await page.locator('.ed-points').getAttribute('value'), attack);
          await page.locator('#log-filter-member').selectOption(attack);
          await page.locator('#log-filter-map').selectOption(attack);
          assert.equal(await page.locator('#admin-log-list .log-card').count(), 1);
          assert.equal(await page.locator('#log-filter-member option').last().textContent(), attack);
          await page.locator('#log-filter-reset').click();
          assert.equal(await page.locator('#log-filter-member').inputValue(), '');
          assert.equal(await page.locator('#member-list img, #admin-log-list img').count(), 0);
          await safe(page); assert.deepEqual(errors, []);
        } finally { await page.close(); }
      }
    });

    await t.test('wizard input values are literal; add/remove handlers survive copied and empty rosters', async () => {
      const { page, errors } = await setup(browser, fixture(payload, attributePayload));
      try {
        await page.locator('#open-switch-wizard').click();
        assert.equal(await page.locator('.wz-name').inputValue(), payload);
        assert.equal(await page.locator('.wz-avatar').inputValue(), attributePayload);
        await page.locator('.wz-remove').click(); assert.equal(await page.locator('.wizard-row .wz-name').count(), 0);
        await page.locator('#wizard-add-row').click(); assert.equal(await page.locator('.wz-name').inputValue(), '');
        await page.locator('#wizard-cancel').click();
        await page.evaluate(() => { window._switchPreview.rosterToCopy = []; });
        await page.locator('#open-switch-wizard').click(); assert.equal(await page.locator('.wz-name').count(), 1);
        await page.locator('.wz-remove').click(); assert.equal(await page.locator('.wz-name').count(), 0);
        await safe(page); assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });

    await t.test('avatar and Map URL payloads fall back; valid images still load', async () => {
      for (const url of ['javascript:alert(1)', 'data:text/html,<script>window.__xss=1</script>', 'data:image/svg+xml,<svg onload="window.__xss=1">', 'x" onerror="window.__xss=1', image]) {
        const { page } = await setup(browser, fixture('Alice', url));
        try {
          const valid = url === image;
          assert.equal(await page.locator('#member-list img').count(), valid ? 1 : 0);
          assert.equal(await page.locator('#admin-log-list img.avatar-md').count(), valid ? 1 : 0);
          if (valid) assert.equal(await page.locator('#member-list img').evaluate(img => img.decode().then(() => img.naturalWidth > 0)), true);
          else assert.equal(await page.locator('#member-list .avatar-fallback').textContent(), 'A');
          await safe(page);
        } finally { await page.close(); }
      }
    });

    await t.test('API failures stay text in create/edit member, entry and wizard flows', async () => {
      const { page } = await setup(browser);
      try {
        await page.route('**/admin/**', route => route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 400, json: { error: payload } }));
        await page.locator('.nm-name').first().fill('New member'); await page.locator('#save-new-members').click();
        await page.getByText('⚠️ ' + payload, { exact: true }).waitFor();
        assert.equal(await page.locator('#member-msg').textContent(), '⚠️ ' + payload);
        await page.locator('.mem-edit').click();
        const dialog = page.waitForEvent('dialog').then(async d => { assert.equal(d.message(), '⚠️ ' + payload); await d.accept(); });
        await page.locator('.mem-save').click(); await dialog;
        await page.locator('#open-switch-wizard').click();
        const confirm = page.waitForEvent('dialog').then(d => d.accept());
        await page.locator('#wizard-submit').click(); await confirm;
        await page.waitForFunction(() => document.querySelector('#wizard-msg').textContent.startsWith('⚠️'));
        assert.equal(await page.locator('#wizard-msg').textContent(), '⚠️ ' + payload);
        await entriesTab(page); await page.locator('#entry-points').fill('10'); await page.locator('#entry-submit').click();
        await page.waitForFunction(() => document.querySelector('#entry-msg').textContent.startsWith('⚠️'));
        assert.equal(await page.locator('#entry-msg').textContent(), '⚠️ ' + payload);
        await page.locator('.ed-edit').click(); await page.locator('.ed-save').click();
        await page.waitForFunction(() => document.querySelector('.log-edit-row p').textContent.startsWith('⚠️'));
        assert.equal(await page.locator('.log-edit-row p').textContent(), '⚠️ ' + payload);
        await safe(page);
      } finally { await page.close(); }
    });

    await t.test('responsive before/after screenshots', { skip: !fs.existsSync(path.join(artifactDir, 'admin-before.js')) && 'Requires local pre-edit admin-before.js' }, async () => {
      const before = await setup(browser, fixture(), fs.readFileSync(path.join(artifactDir, 'admin-before.js'), 'utf8'));
      const after = await setup(browser);
      try {
        for (const width of [390, 768, 1440]) for (const view of ['members', 'member-edit', 'wizard', 'entries', 'entry-edit']) {
          const shots = [];
          for (const [label, { page }] of [['before', before], ['after', after]]) {
            await page.setViewportSize({ width, height: 900 });
            await membersTab(page); await page.locator('#wizard-cancel').click({ force: true }).catch(() => {});
            if (await page.locator('.mem-cancel').isVisible()) await page.locator('.mem-cancel').click();
            if (view === 'member-edit') await page.locator('.mem-edit').click();
            if (view === 'wizard') await page.locator('#open-switch-wizard').click();
            if (view.startsWith('entr')) {
              await entriesTab(page);
              if (await page.locator('.ed-cancel').isVisible()) await page.locator('.ed-cancel').click();
              if (view === 'entry-edit') await page.locator('.ed-edit').click();
            }
            await page.evaluate(async () => { await Promise.all([...document.images].map(img => img.decode().catch(() => {}))); });
            shots.push(await page.screenshot({ path: path.join(artifactDir, `${label}-${width}-${view}.png`), fullPage: true, animations: 'disabled' }));
          }
          assert.ok(shots[0].equals(shots[1]), `Layout changed at ${width}/${view}`);
        }
      } finally { await before.page.close(); await after.page.close(); }
    });

    await t.test('real session/API/database: create/edit member and create/edit log preserve data and IDs', async () => {
      const { createDb } = require('../db'); const { createApp } = require('../server');
      const { migrateCredentials } = require('../auth/migrate');
      const db = createDb(':memory:');
      db.prepare('INSERT INTO gyms(name,slug,admin_code) VALUES (?,?,?)').run('Test gym', 'test', 'gym-test-password');
      db.exec(`INSERT INTO season_templates(id,name,is_active,last_defined_round_number,battle_start_at,ticket_day1_amount,ticket_daily_amount,ticket_regen_days)
        VALUES (1,'Season',1,1,'2026-01-01',10,1,1);
        INSERT INTO season_template_maps(id,season_template_id,name,order_index) VALUES (1,1,'Map',1);
        INSERT INTO season_template_rounds(season_template_id,round_number,max_score,order_index) VALUES (1,1,100,1);
        INSERT INTO gym_seasons(id,gym_id,season_template_id) VALUES (1,1,1);`);
      db.prepare('UPDATE season_template_maps SET name=?,image_url=? WHERE id=1').run(payload, 'javascript:alert(1)');
      require('../engine').recomputeRoundChain(db, 1);
      await migrateCredentials(db, { env: { MASTER_ADMIN_CODE: 'master fixture password' } });
      const app = createApp(db, { env: { SESSION_SECRETS: 's'.repeat(32), AUTH_RATE_LIMIT_SECRET: 'r'.repeat(32) } });
      const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const context = await browser.newContext();
      await context.route('https://fonts.googleapis.com/**', route => route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(7000);
      const errors = []; const mutations = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (['POST', 'PATCH'].includes(r.method())) mutations.push({ url: r.url(), body: r.postDataJSON(), csrf: r.headers()['x-csrf-token'] }); });
      await page.addInitScript(() => { window.__xss = 0; });
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/g/test#admin`);
        await page.locator('#admin-code').fill('gym-test-password'); await page.locator('#unlock-btn').click();
        await page.locator('#panel').waitFor({ state: 'visible' });
        await page.locator('.nm-name').first().fill(payload); await page.locator('.nm-avatar').first().fill('javascript:alert(1)');
        await page.locator('#save-new-members').click(); await page.locator('#member-list .list-row').waitFor();
        const member = db.prepare('SELECT * FROM members').get(); assert.equal(member.name, payload);
        await page.locator('.mem-edit').click(); await page.locator('.mem-name').fill('draft'); await page.locator('.mem-cancel').click();
        assert.equal(await page.locator('.mem-name').inputValue(), payload);
        await page.locator('.mem-edit').click(); await page.locator('.mem-name').fill(payload + ' edited');
        await page.locator('.mem-avatar').fill(image); await page.locator('.mem-save').click();
        await page.waitForFunction(() => document.querySelector('.member-inline > span')?.textContent.endsWith(' edited'));
        assert.equal(db.prepare('SELECT count(*) n FROM members').get().n, 1);
        assert.equal(db.prepare('SELECT name FROM members WHERE id=?').get(member.id).name, payload + ' edited');
        await entriesTab(page); await page.locator('#entry-points').fill('20'); await page.locator('#entry-submit').click();
        await page.locator('#admin-log-list .log-card').waitFor();
        const entry = db.prepare('SELECT * FROM entries').get(); assert.equal(entry.points_scored, 20); assert.equal(entry.member_id, member.id);
        await page.locator('.ed-edit').click(); await page.locator('.ed-points').fill('99'); await page.locator('.ed-cancel').click();
        assert.equal(await page.locator('.ed-points').inputValue(), '20');
        await page.locator('.ed-edit').click(); await page.locator('.ed-points').fill('30'); await page.locator('.ed-tickets').selectOption('2'); await page.locator('.ed-save').click();
        await page.waitForFunction(() => document.querySelector('.log-view-row strong')?.textContent === '30');
        const edited = db.prepare('SELECT * FROM entries WHERE id=?').get(entry.id);
        assert.equal(edited.points_scored, 30); assert.equal(edited.tickets_used, 2); assert.equal(edited.member_id, member.id);
        assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n, 1);
        await page.locator('#log-filter-member').selectOption(String(member.id)); await page.locator('#log-filter-map').selectOption('1'); await page.locator('#log-filter-round').selectOption('1');
        assert.equal(await page.locator('#admin-log-list .log-card').count(), 1);
        const business = mutations.filter(m => !m.url.includes('/auth/'));
        assert.equal(business.length, 4); assert.ok(business.every(m => m.csrf));
        assert.equal(business[0].body.members[0].name, payload); assert.equal(business[1].body.name, payload + ' edited');
        await safe(page); assert.deepEqual(errors, []);
      } finally { await context.close(); await new Promise(resolve => server.close(resolve)); db.close(); }
    });
  } finally { await browser.close(); }
});

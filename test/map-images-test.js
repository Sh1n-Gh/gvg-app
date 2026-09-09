const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { normalize, createStore, MAX_BYTES } = require('../security/map-images');
const make = (width = 4, height = 3) => sharp({ create: { width, height, channels: 4, background: '#12345680' } });

test('PNG/JPEG fully decode, preserve dimensions/alpha, strip metadata and trailing payload', async () => {
  for (const format of ['png', 'jpeg']) {
    const source = await make().withMetadata({ orientation: 6 }).toFormat(format).toBuffer();
    const { data, extension } = await normalize(Buffer.concat([source, Buffer.from('<script>evil</script>')]));
    const meta = await sharp(data).metadata();
    assert.equal(extension, format === 'png' ? 'png' : 'jpg');
    assert.equal(meta.width, 3); assert.equal(meta.height, 4);
    for (const key of ['exif', 'icc', 'iptc', 'xmp', 'orientation']) assert.equal(meta[key], undefined);
    if (format === 'png') assert.equal(meta.hasAlpha, true);
    assert.ok(!data.includes(Buffer.from('<script>')));
    await sharp(data).raw().toBuffer();
  }
});

test('reject fake extensions, wrong magic, signature-only and truncated images', async () => {
  const png = await make().png().toBuffer();
  for (const data of [Buffer.from('<svg/>'), Buffer.from('GIF89a'), Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('ffd8ff', 'hex'), png.subarray(0, 45)]) {
    await assert.rejects(normalize(data), { status: 400 });
  }
});

test('reject byte, width, height and total pixel bombs before storage', async () => {
  await assert.rejects(normalize(Buffer.alloc(MAX_BYTES + 1)), { status: 413 });
  for (const [width, height] of [[8193, 1], [1, 8193], [4001, 4000]]) {
    const data = await make(width, height).png().toBuffer();
    assert.ok(data.length < MAX_BYTES);
    await assert.rejects(normalize(data), { status: 413 });
  }
});

test('quota counts old/orphan files, rejects concurrent overflow, never removes files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p13-quota-'));
  try {
    const data = await make().png().toBuffer();
    fs.writeFileSync(path.join(dir, 'legacy.png'), data);
    const store = createStore(dir, { maxFiles: 2 });
    const results = await Promise.allSettled([store.save(data), store.save(data)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'legacy.png')), data);
    await assert.rejects(createStore(dir, { maxBytes: 1 }).save(data), { status: 409 });
    assert.equal(fs.readdirSync(dir).length, 2);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('HTTP upload ignores filename/MIME claims, fixed serving, template edit retains old image', async () => {
  const { createDb } = require('../db');
  const { createApp } = require('../server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p13-http-'));
  const snapshotName = 'p13-' + require('node:crypto').randomUUID();
  const db = createDb(':memory:');
  await require('../auth/migrate').migrateCredentials(db, { env: { MASTER_ADMIN_CODE: 'test-master-password' } });
  db.exec(`INSERT INTO season_templates VALUES(1,'P13',0,1,NULL,'2026-01-01T00:00:00Z',1,1,1,datetime('now'));
    INSERT INTO season_template_maps VALUES(1,1,'Map','fire','', '',1);
    INSERT INTO season_template_rounds VALUES(1,1,1,100,1);`);
  const app = createApp(db, { env: {}, mapImages: createStore(dir) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(base + '/master/auth/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-master-password' }) });
    assert.equal(login.status, 200);
    const headers = { Origin: base, Cookie: login.headers.getSetCookie()[0].split(';')[0], 'X-CSRF-Token': (await login.json()).csrf_token };
    const urls = [];
    for (let i = 0; i < 2; i++) {
      const r = await fetch(base + '/master/map-images', { method: 'POST', headers: { ...headers, 'Content-Type': 'image/jpeg', 'Content-Disposition': 'attachment; filename="../../evil.html"' }, body: await make().png().toBuffer() });
      assert.equal(r.status, 200); const url = (await r.json()).image_url; urls.push(url);
      assert.match(url, /^\/uploads\/map-images\/[0-9a-f-]{36}\.png$/);
      const image = await fetch(base + url); assert.equal(image.headers.get('content-type'), 'image/png'); assert.equal(image.headers.get('x-content-type-options'), 'nosniff'); await image.arrayBuffer();
      const body = { name: snapshotName, last_defined_round_number: 1, repeat_max_score: null, ticket_config: { battle_start_at: '2026-01-01T00:00:00Z', day1_amount: 1, daily_amount: 1, regen_days: 1 }, maps: [{ id: 1, name: 'Map edited', type_weakness: 'fire', image_url: url }], rounds: [{ round_number: 1, max_score: 100 }] };
      const edit = await fetch(base + '/master/season-templates/1', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(edit.status, 200, await edit.text());
      assert.equal(db.prepare('SELECT image_url FROM season_template_maps WHERE id=1').get().image_url, url);
    }
    assert.equal((await fetch(base + urls[0])).status, 200);
    fs.writeFileSync(path.join(dir, 'evil.html'), '<script>evil</script>');
    assert.equal((await fetch(base + '/uploads/map-images/evil.html')).status, 404);
    const bad = await fetch(base + '/master/map-images', { method: 'POST', headers: { ...headers, 'Content-Type': 'image/png' }, body: '<svg/>' });
    assert.equal(bad.status, 400);
  } finally {
    app.locals.auth.close(); await new Promise(r => server.close(r)); db.close();
    fs.rmSync(dir, { recursive: true });
    const snapshot = path.join(__dirname, '../season-configs', `1-${snapshotName}.json`);
    if (fs.existsSync(snapshot)) fs.unlinkSync(snapshot);
  }
});

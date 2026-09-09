// ===== SMOKE TEST — Master Admin API routes =====
// Không dùng thêm dependency nào (không supertest). Dùng http.createServer thật
// + fetch built-in của Node (>=18) để gọi HTTP thật tới `createApp()` đã export từ server.js.
// Mục tiêu: xác nhận các route quan trọng nhất của Master Admin trả đúng status/shape,
// và xác nhận việc refactor server.js (tách createApp) không phá vỡ mounting của
// gym-admin / gym-public routes (regression check nhẹ).

const fs = require('fs');
const path = require('path');
const http = require('http');

// Explicit test-only legacy credential; production has no default credential.
const MASTER_CODE = 'test-master-code';
process.env.MASTER_ADMIN_CODE = MASTER_CODE;

const { createDb } = require('../db');
const { createApp } = require('../server');

const rehearsal = process.argv.includes('--restore-rehearsal');
const fixtureDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gvg-smoke-'));
const DB_PATH = path.join(fixtureDir, 'restored.db');
let db, server;

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}  ${detail}`); }
}
function section(title) { console.log(`\n=== ${title} ===`); }

let baseUrl;
let createdSnapshotFiles = [];
let createdUploadFiles = [];

async function main() {
  if (rehearsal) {
    const { backup, restore, verify } = require('../scripts/sqlite-backup');
    const sourcePath = path.join(fixtureDir, 'source.db');
    const source = createDb(sourcePath);
    try {
      source.pragma('wal_autocheckpoint = 0');
      source.exec('CREATE TABLE restore_probe(value TEXT NOT NULL)');
      source.prepare('INSERT INTO restore_probe VALUES (?)').run('committed WAL fixture');
      const receipt = await backup({ source: sourcePath, directory: fixtureDir });
      await restore(receipt.path, DB_PATH);
      db = createDb(DB_PATH);
      verify(db);
      check('Restored database contains committed WAL fixture', db.prepare('SELECT value FROM restore_probe').get().value === 'committed WAL fixture');
      check('Restore integrity_check = ok', db.pragma('integrity_check', { simple: true }) === 'ok');
    } finally { source.close(); }
  } else db = createDb(DB_PATH);
  const app = createApp(db);
  server = http.createServer(app);
  db.prepare("INSERT INTO auth_principals(role,password_hash,must_rotate) VALUES ('master',?,1)").run(await require('../auth/password').hashPassword(MASTER_CODE, { legacy: true }));
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  async function loginHeaders(prefix, password) {
    const response = await fetch(baseUrl + prefix + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl }, body: JSON.stringify({ password }),
    });
    if (!response.ok) throw new Error('Session fixture login failed');
    const data = await response.json();
    return { Cookie: response.headers.getSetCookie()[0].split(';')[0], 'X-CSRF-Token': data.csrf_token,
      'Content-Type': 'application/json', Origin: baseUrl };
  }
  const authHeaders = await loginHeaders('/master', MASTER_CODE);

  // ===================================================================
  section('AUTH — chặn khi thiếu/sai mã Master Admin');
  // ===================================================================
  {
    const res = await fetch(`${baseUrl}/master/season-templates`);
    check('GET /master/season-templates không có mã -> 401', res.status === 401, `status=${res.status}`);
  }
  {
    const res = await fetch(`${baseUrl}/master/season-templates`, { headers: { 'x-master-admin-code': 'sai-ma' } });
    check('GET /master/season-templates sai mã -> 401', res.status === 401, `status=${res.status}`);
  }
  {
    const res = await fetch(`${baseUrl}/master/auth/session`, { headers: authHeaders });
    const body = await res.json();
    check('GET /master/auth/session -> 200 ok:true', res.status === 200 && body.ok === true);
  }


  // ===================================================================
  section('SEASON TEMPLATES');
  // ===================================================================
  {
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    );
    const res = await fetch(`${baseUrl}/master/map-images`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'image/png' },
      body: tinyPng,
    });
    const body = await res.json();
    check('POST /master/map-images nhận PNG hợp lệ -> URL nội bộ',
      res.status === 200 && body.ok === true && /^\/uploads\/map-images\/.+\.png$/.test(body.image_url));
    if (body.image_url) {
      createdUploadFiles.push(path.join(__dirname, '..', 'public', body.image_url.replace(/^\//, '')));
      const staticRes = await fetch(`${baseUrl}${body.image_url}`);
      check('Ảnh Map đã upload được phục vụ qua static URL',
        staticRes.status === 200 && /image\/png/.test(staticRes.headers.get('content-type') || ''));
    }
  }
  {
    const res = await fetch(`${baseUrl}/master/map-images`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'image/png' },
      body: Buffer.from('not-a-real-png'),
    });
    const body = await res.json();
    check('POST /master/map-images từ chối nội dung giả PNG',
      res.status === 400 && /PNG hoặc JPEG/.test(body.error));
  }
  {
    const res = await fetch(`${baseUrl}/master/map-images`, {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    check('POST /master/map-images vẫn yêu cầu Master Admin', res.status === 401);
  }
  {
    const res = await fetch(`${baseUrl}/master/season-templates`, { headers: authHeaders });
    const body = await res.json();
    check('GET /master/season-templates rỗng lúc đầu -> 200 []', res.status === 200 && Array.isArray(body) && body.length === 0);
  }

  const seasonPayload = {
    name: 'Smoke Test Season',
    maps: [
      { name: 'Map A', type_weakness: 'fire', image_url: 'https://example.test/map-a.png' },
      { name: 'Map B' },
    ],
    rounds: [{ round_number: 1, max_score: 100 }, { round_number: 2, max_score: 200 }],
    repeat_max_score: 500,
    ticket_config: { battle_start_at: new Date().toISOString(), day1_amount: 12, daily_amount: 3, regen_days: 6 },
  };
  let seasonId;
  {
    const res = await fetch(`${baseUrl}/master/season-templates`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify(seasonPayload),
    });
    const body = await res.json();
    check('POST /master/season-templates hợp lệ -> 200 ok:true + id', res.status === 200 && body.ok === true && !!body.season_template_id);
    seasonId = body.season_template_id;
    if (body.snapshot_file) createdSnapshotFiles.push(body.snapshot_file);
  }
  {
    const res = await fetch(`${baseUrl}/master/season-templates`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ name: '' }),
    });
    check('POST /master/season-templates thiếu dữ liệu -> 400', res.status === 400);
  }
  {
    // Type Weakness phải là 1 trong 18 Pokemon Type hợp lệ — không cho tự do
    const res = await fetch(`${baseUrl}/master/season-templates`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ ...seasonPayload, maps: [{ name: 'Map X', type_weakness: 'không-phải-type-hợp-lệ' }] }),
    });
    const body = await res.json();
    check('POST season-templates với type_weakness không hợp lệ -> 400', res.status === 400 && /Type Weakness/.test(body.error));
  }
  {
    // Hoa/thường không quan trọng, và giá trị rỗng luôn được phép (map không có type)
    const res = await fetch(`${baseUrl}/master/season-templates`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ ...seasonPayload, maps: [{ name: 'Map Y', type_weakness: 'FIRE' }, { name: 'Map Z' }] }),
    });
    const body = await res.json();
    check('POST season-templates với type_weakness hợp lệ (không phân biệt hoa/thường) + map không type -> 200', res.status === 200 && body.ok === true);
    if (body.snapshot_file) createdSnapshotFiles.push(body.snapshot_file);
    if (body.ok) {
      const detail = await (await fetch(`${baseUrl}/master/season-templates/${body.season_template_id}`, { headers: authHeaders })).json();
      check('Type Weakness được chuẩn hoá về key lowercase khi lưu', detail.maps[0].type_weakness === 'fire');
    }
  }
  {
    const res = await fetch(`${baseUrl}/master/season-templates/${seasonId}`, { headers: authHeaders });
    const body = await res.json();
    check('GET /master/season-templates/:id -> đúng 2 map, 2 round',
      res.status === 200 && body.maps.length === 2 && body.rounds.length === 2);
    check('repeat_max_score tự lấy max_score của Round cuối, bỏ qua giá trị client gửi',
      body.season.repeat_max_score === 200);
  }
  {
    const res = await fetch(`${baseUrl}/master/season-templates/999999`, { headers: authHeaders });
    check('GET /master/season-templates/:id không tồn tại -> 404', res.status === 404);
  }
  {
    const res = await fetch(`${baseUrl}/master/season-templates/${seasonId}/activate`, {
      method: 'PATCH', headers: authHeaders,
    });
    const body = await res.json();
    check('PATCH /master/season-templates/:id/activate -> 200 ok:true', res.status === 200 && body.ok === true);
  }
  {
    const row = db.prepare('SELECT is_active FROM season_templates WHERE id = ?').get(seasonId);
    check('Season vừa activate thực sự is_active=1 trong DB', row.is_active === 1);
  }

  // ===================================================================
  section('GYMS');
  // ===================================================================
  let gymId, gymSlug, gymAdminCode;
  {
    const res = await fetch(`${baseUrl}/master/gyms`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ name: 'Smoke Test Gym' }),
    });
    const body = await res.json();
    check('POST /master/gyms hợp lệ (đã có season active) -> 200 ok:true + admin_code',
      res.status === 200 && body.ok === true && !!body.gym.admin_code);
    gymId = body.gym.id; gymSlug = body.gym.slug; gymAdminCode = body.gym.admin_code;
    const principal = db.prepare("SELECT password_hash,must_rotate FROM auth_principals WHERE role='gym' AND gym_id=?").get(gymId);
    check('P03 gym principal verifies legacy code', principal && principal.must_rotate === 1
      && await require('../auth/password').verifyPassword(gymAdminCode, principal.password_hash));
    check('P03 credential response is no-store', res.headers.get('cache-control') === 'no-store');
  }
  {
    const res = await fetch(`${baseUrl}/master/gyms`, { headers: authHeaders });
    const rows = await res.json();
    check('P03 gym list excludes credentials', rows.every(row => !('admin_code' in row) && !('password_hash' in row)));
    db.exec("CREATE TRIGGER p03_fail BEFORE INSERT ON auth_principals BEGIN SELECT RAISE(ABORT,'test'); END");
    try {
      const failed = await fetch(`${baseUrl}/master/gyms`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ name: 'Atomic Failure Gym' }),
      });
      check('P03 failed principal insert rolls back gym', failed.status === 409
        && !db.prepare("SELECT id FROM gyms WHERE slug='atomic-failure-gym'").get());
    } finally { db.exec('DROP TRIGGER p03_fail'); }
  }
  {
    const res = await fetch(`${baseUrl}/master/gyms/check-slug?slug=${encodeURIComponent(gymSlug)}`, { headers: authHeaders });
    const body = await res.json();
    check('GET check-slug với slug đã dùng -> available:false', res.status === 200 && body.available === false);
  }
  {
    const res = await fetch(`${baseUrl}/master/gyms/check-slug?slug=mot-slug-chua-ai-dung`, { headers: authHeaders });
    const body = await res.json();
    check('GET check-slug với slug mới -> available:true', res.status === 200 && body.available === true);
  }
  {
    const res = await fetch(`${baseUrl}/g/${gymSlug}/admin`, { redirect: 'manual' });
    check('Trang Admin cũ redirect về tab Admin tích hợp trong trang Gym',
      res.status === 302 && res.headers.get('location') === `/g/${gymSlug}#admin`);
  }

  // ===================================================================
  section('GYM ADMIN — MEMBER AVATAR + ENTRY EDIT/MAP METADATA');
  // ===================================================================
  const gymAdminHeaders = await loginHeaders(`/g/${gymSlug}/admin`, gymAdminCode);
  let memberId, gymSeasonId, entryId, mapId;
  {
    const res = await fetch(`${baseUrl}/g/${gymSlug}/admin/members/bulk`, {
      method: 'POST', headers: gymAdminHeaders,
      body: JSON.stringify({ members: [{ name: 'Avatar Tester', avatar_url: 'https://example.test/old.png' }] }),
    });
    const body = await res.json();
    check('Tạo member qua API -> created:1', res.status === 200 && body.created === 1);
    const member = db.prepare(`
      SELECT m.* FROM members m
      JOIN gym_seasons gs ON gs.id = m.gym_season_id
      WHERE gs.gym_id = ? AND gs.is_active = 1 AND m.name = ?
    `).get(gymId, 'Avatar Tester');
    memberId = member.id;
    gymSeasonId = member.gym_season_id;
    mapId = db.prepare('SELECT id FROM season_template_maps WHERE season_template_id = ? ORDER BY order_index LIMIT 1').get(seasonId).id;
  }
  {
    const res = await fetch(`${baseUrl}/g/${gymSlug}/admin/entries`, {
      method: 'POST', headers: gymAdminHeaders,
      body: JSON.stringify({ member_id: memberId, map_id: mapId, tickets_used: 1, points_scored: 40 }),
    });
    const body = await res.json();
    check('Tạo Entry mới vẫn hoạt động -> giữ id Entry', res.status === 200 && body.ok === true && !!body.entry_id);
    entryId = body.entry_id;
  }
  {
    const res = await fetch(`${baseUrl}/g/${gymSlug}/admin/members/${memberId}`, {
      method: 'PATCH', headers: gymAdminHeaders,
      body: JSON.stringify({ avatar_url: 'https://example.test/new.png' }),
    });
    const body = await res.json();
    const memberAfter = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
    const historyAfter = db.prepare('SELECT member_id FROM entries WHERE id = ?').get(entryId);
    check('PATCH avatar Member -> 200, đúng URL mới', res.status === 200 && body.ok === true && memberAfter.avatar_url === 'https://example.test/new.png');
    check('Sửa avatar giữ nguyên member.id/gym_season_id và lịch sử Entry',
      memberAfter.id === memberId && memberAfter.gym_season_id === gymSeasonId && historyAfter.member_id === memberId);
  }
  {
    const res = await fetch(`${baseUrl}/g/${gymSlug}/admin/entries`, { headers: gymAdminHeaders });
    const body = await res.json();
    const entry = body.find(row => row.id === entryId);
    check('Danh sách Entry trả map image + type key để UI render icon',
      res.status === 200 && entry?.map_image === 'https://example.test/map-a.png' && entry?.map_type === 'fire');
  }
  {
    const res = await fetch(`${baseUrl}/g/${gymSlug}/admin/entries/${entryId}`, {
      method: 'PATCH', headers: gymAdminHeaders,
      body: JSON.stringify({ tickets_used: 2, points_scored: 60 }),
    });
    const body = await res.json();
    const entryAfter = db.prepare('SELECT * FROM entries WHERE id = ?').get(entryId);
    const progressAfter = db.prepare(`
      SELECT current_points FROM gym_round_map_progress
      WHERE gym_season_id = ? AND round_number = 1 AND season_template_map_id = ?
    `).get(gymSeasonId, mapId);
    check('PATCH Entry cập nhật đúng bản ghi hiện tại, không delete/create',
      res.status === 200 && body.ok === true && entryAfter.id === entryId && entryAfter.tickets_used === 2 && entryAfter.points_scored === 60);
    check('PATCH Entry cập nhật progress theo delta', progressAfter.current_points === 60);
  }
  {
    const res = await fetch(`${baseUrl}/g/${gymSlug}/admin/entries/${entryId}`, {
      method: 'PATCH', headers: gymAdminHeaders,
      body: JSON.stringify({ points_scored: 101 }),
    });
    const body = await res.json();
    const entryAfter = db.prepare('SELECT points_scored FROM entries WHERE id = ?').get(entryId);
    const progressAfter = db.prepare(`
      SELECT current_points FROM gym_round_map_progress
      WHERE gym_season_id = ? AND round_number = 1 AND season_template_map_id = ?
    `).get(gymSeasonId, mapId);
    check('PATCH Entry vượt max_score -> 400 với thông báo rõ', res.status === 400 && /vượt trần/.test(body.error));
    check('PATCH Entry bị reject không đổi Entry/progress', entryAfter.points_scored === 60 && progressAfter.current_points === 60);
  }
  {
    const createMemberRes = await fetch(`${baseUrl}/g/${gymSlug}/admin/members/bulk`, {
      method: 'POST', headers: gymAdminHeaders,
      body: JSON.stringify({ members: [{ name: 'Lower Score Member' }] }),
    });
    const secondMember = db.prepare('SELECT * FROM members WHERE gym_season_id = ? AND name = ?')
      .get(gymSeasonId, 'Lower Score Member');
    const createEntryRes = await fetch(`${baseUrl}/g/${gymSlug}/admin/entries`, {
      method: 'POST', headers: gymAdminHeaders,
      body: JSON.stringify({ member_id: secondMember.id, map_id: mapId, tickets_used: 1, points_scored: 30 }),
    });
    check('Setup member thứ hai cho leaderboard thành công', createMemberRes.status === 200 && createEntryRes.status === 200);

    const res = await fetch(`${baseUrl}/g/${gymSlug}/leaderboard`);
    const body = await res.json();
    const first = body[0];
    const second = body[1];
    check('Leaderboard sort tổng điểm cao xuống thấp',
      res.status === 200 && first.id === memberId && first.total_points === 60 && second.total_points === 30);
    check('Leaderboard trả đủ vé cấp/dùng/còn/sẽ nhận và trung bình điểm/vé',
      first.tickets_granted === 12 && first.tickets_used === 2 && first.tickets_remaining === 10
      && first.tickets_future === 18 && first.average_points_per_ticket === 30);

    const logRes = await fetch(`${baseUrl}/g/${gymSlug}/log`);
    const logRows = await logRes.json();
    const loggedEntry = logRows.find(row => row.id === entryId);
    check('Public log trả member_id và map_id để lọc Thành viên/Round/Map',
      logRes.status === 200 && loggedEntry?.member_id === memberId
      && loggedEntry?.season_template_map_id === mapId);

    const overviewRes = await fetch(`${baseUrl}/g/${gymSlug}/overview`);
    const overview = await overviewRes.json();
    const firstScoreCell = overview.score_cells.find(cell => cell.member_id === memberId && cell.map_id === mapId);
    const firstTicketCell = overview.ticket_cells.find(cell => cell.round_number === 1 && cell.map_id === mapId);
    check('Overview trả ma trận điểm Member × Map chính xác',
      overviewRes.status === 200 && firstScoreCell?.total_points === 60 && overview.members.length === 2);
    check('Overview sort Member theo tổng điểm cao xuống thấp',
      overview.members[0]?.id === memberId && overview.members[0]?.total_points === 60
      && overview.members[1]?.total_points === 30);
    check('Overview giữ đúng thứ tự vé đã ghi trong ô Round × Map',
      JSON.stringify(firstTicketCell?.tickets) === JSON.stringify([2, 1]) && overview.rounds.includes(1));
  }
  {
    const res = await fetch(`${baseUrl}/master/gyms/${gymId}/delete`, { method: 'PATCH', headers: authHeaders });
    const body = await res.json();
    check('PATCH /master/gyms/:id/delete -> 200 ok:true', res.status === 200 && body.ok === true);
  }
  {
    const row = db.prepare('SELECT deleted_at FROM gyms WHERE id = ?').get(gymId);
    check('Gym vừa xoá có deleted_at khác NULL (soft-delete)', row.deleted_at != null);
  }
  {
    // Regression check nhẹ: Gym đã soft-delete phải 404 ở public route (đã có từ Phase 1-5, không được vỡ)
    const res = await fetch(`${baseUrl}/g/${gymSlug}/state`);
    check('Public /g/:slug/state của Gym đã xoá -> 404 (regression check)', res.status === 404);
  }
  {
    const res = await fetch(`${baseUrl}/master/gyms/${gymId}/restore`, { method: 'PATCH', headers: authHeaders });
    const body = await res.json();
    check('PATCH /master/gyms/:id/restore -> 200 ok:true', res.status === 200 && body.ok === true);
  }
  {
    // Regression check nhẹ: sau khi khôi phục, public dashboard phải sống lại bình thường
    const res = await fetch(`${baseUrl}/g/${gymSlug}/state`);
    check('Public /g/:slug/state sau khi khôi phục -> 200 (regression check)', res.status === 200);
  }

  // ===================================================================
  section('GYM REQUESTS (stub, chỉ GET — approve/reject là Phase 7)');
  // ===================================================================
  {
    const res = await fetch(`${baseUrl}/master/gym-requests`, { headers: authHeaders });
    const body = await res.json();
    check('GET /master/gym-requests -> 200 mảng (rỗng vì chưa có request nào)', res.status === 200 && Array.isArray(body));
  }

  // ===================================================================
  section('REGRESSION — gym-admin routes vẫn hoạt động bình thường sau refactor server.js');
  // ===================================================================
  {
    const res = await fetch(`${baseUrl}/g/${gymSlug}/admin/auth/session`, { headers: gymAdminHeaders });
    const body = await res.json();
    check('GET /g/:slug/admin/auth/session -> 200 ok:true', res.status === 200 && body.ok === true);
  }
  {
    const res = await fetch(`${baseUrl}/g/${gymSlug}/admin/auth/session`, { headers: { 'x-admin-code': gymAdminCode } });
    check('Legacy header cannot authenticate Gym session -> 401', res.status === 401);
  }

  console.log('\n' + '='.repeat(50));
  console.log(`KẾT QUẢ: ${pass} PASS / ${fail} FAIL (tổng ${pass + fail} test)`);
  console.log('='.repeat(50));

  await new Promise((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve());
  });
  db.close();
  [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm'].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
  createdSnapshotFiles.forEach(f => {
    const full = path.join(__dirname, '..', 'season-configs', f);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  });
  createdUploadFiles.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('SMOKE TEST CRASHED:', err);
  process.exit(1);
});



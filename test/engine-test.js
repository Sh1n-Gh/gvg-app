const fs = require('fs');
const path = require('path');
const { createDb } = require('../db');
const engine = require('../engine');

const fixtureDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gvg-engine-'));
const DB_PATH = path.join(fixtureDir, 'test.db');
const db = createDb(DB_PATH);
process.on('exit', () => { db.close(); fs.rmSync(fixtureDir, { recursive: true, force: true }); });

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}  ${detail}`); }
}
function section(title) { console.log(`\n=== ${title} ===`); }

function makeSeason({ name, lastRound, repeatMax, day1 = 12, daily = 3, regenDays = 6, battleStart }) {
  const info = db.prepare(`
    INSERT INTO season_templates
      (name, is_active, last_defined_round_number, repeat_max_score, battle_start_at,
       ticket_day1_amount, ticket_daily_amount, ticket_regen_days)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?)
  `).run(name, lastRound, repeatMax, battleStart.toISOString(), day1, daily, regenDays);
  return { id: info.lastInsertRowid, ...db.prepare('SELECT * FROM season_templates WHERE id=?').get(info.lastInsertRowid) };
}

// ===================================================================
section('SETUP — Season A (có repeat_max_score, dùng cho phần lớn test)');
// ===================================================================
const battleStart = new Date('2026-08-03T13:00:00Z');
const seasonTemplate = makeSeason({ name: 'Season A', lastRound: 3, repeatMax: 900, battleStart });

const mapA = db.prepare(`INSERT INTO season_template_maps (season_template_id, name, order_index) VALUES (?, 'Falkner', 1)`).run(seasonTemplate.id).lastInsertRowid;
const mapB = db.prepare(`INSERT INTO season_template_maps (season_template_id, name, order_index) VALUES (?, 'Bugsy', 2)`).run(seasonTemplate.id).lastInsertRowid;

db.prepare(`INSERT INTO season_template_rounds (season_template_id, round_number, max_score, order_index) VALUES (?, 1, 100, 1)`).run(seasonTemplate.id);
db.prepare(`INSERT INTO season_template_rounds (season_template_id, round_number, max_score, order_index) VALUES (?, 2, 300, 2)`).run(seasonTemplate.id);
db.prepare(`INSERT INTO season_template_rounds (season_template_id, round_number, max_score, order_index) VALUES (?, 3, 600, 3)`).run(seasonTemplate.id);

const gymId = db.prepare(`INSERT INTO gyms (name, slug, admin_code) VALUES ('Test Gym', 'test-gym', 'code123')`).run().lastInsertRowid;
const gymSeasonId = db.prepare(`INSERT INTO gym_seasons (gym_id, season_template_id) VALUES (?, ?)`).run(gymId, seasonTemplate.id).lastInsertRowid;
const memberId = db.prepare(`INSERT INTO members (gym_season_id, name) VALUES (?, 'PlayerA')`).run(gymSeasonId).lastInsertRowid;
const memberBanned = db.prepare(`INSERT INTO members (gym_season_id, name) VALUES (?, 'PlayerBad')`).run(gymSeasonId).lastInsertRowid;

const nowT = battleStart.getTime() + 1000;

// ⭐ QUAN TRỌNG: phải chạy recomputeRoundChain 1 lần ngay sau khi tạo gym_season
// để Round 1 được khởi tạo 'active' NGAY TỪ ĐẦU (theo đúng note mới bổ sung vào PRD)
engine.recomputeRoundChain(db, gymSeasonId);
check('Sau khi khởi tạo gym_season + chạy recompute lần đầu, Round 1 = active ngay (chưa cần entry nào)',
  engine.getActiveRoundNumber(db, gymSeasonId) === 1);

// ===================================================================
section('TEST — Validate số vé (mới bổ sung theo review)');
// ===================================================================
let err = null;
try {
  engine.createEntry(db, { gymSeasonId, roundNumber: 1, mapId: mapA, memberId, ticketsUsed: 0, pointsScored: 10, seasonTemplate, nowMs: nowT });
} catch (e) { err = e.message; }
check('Từ chối tickets_used = 0', err && err.includes('vé phải là số nguyên'), `got "${err}"`);

err = null;
try {
  engine.createEntry(db, { gymSeasonId, roundNumber: 1, mapId: mapA, memberId, ticketsUsed: 4, pointsScored: 10, seasonTemplate, nowMs: nowT });
} catch (e) { err = e.message; }
check('Từ chối tickets_used = 4 (vượt trần 3)', err && err.includes('vé phải là số nguyên'), `got "${err}"`);

// ===================================================================
section('TEST — Chỉ được tạo Entry MỚI cho đúng Round đang active (mới bổ sung)');
// ===================================================================
err = null;
try {
  engine.createEntry(db, { gymSeasonId, roundNumber: 2, mapId: mapA, memberId, ticketsUsed: 1, pointsScored: 10, seasonTemplate, nowMs: nowT });
} catch (e) { err = e.message; }
check('Từ chối ghi Entry cho Round 2 khi Round 1 mới là active', err && err.includes('đang active'), `got "${err}"`);

// ===================================================================
section('TEST — Clear Round 1 (cả 2 map) -> Round 1 completed, Round 2 active');
// ===================================================================
engine.createEntry(db, { gymSeasonId, roundNumber: 1, mapId: mapA, memberId, ticketsUsed: 1, pointsScored: 100, seasonTemplate, nowMs: nowT });
const entryB1 = engine.createEntry(db, { gymSeasonId, roundNumber: 1, mapId: mapB, memberId, ticketsUsed: 1, pointsScored: 100, seasonTemplate, nowMs: nowT });
check('Round 1 = completed', db.prepare(`SELECT status FROM gym_round_status WHERE gym_season_id=? AND round_number=1`).get(gymSeasonId).status === 'completed');
check('Round 2 = active', engine.getActiveRoundNumber(db, gymSeasonId) === 2);

// ===================================================================
section('TEST — Sub-Admin SỬA Entry của Round ĐÃ COMPLETED -> tự động reopen (quyết định mới)');
// ===================================================================
engine.editEntry(db, { entryId: entryB1.entryId, ticketsUsed: 1, pointsScored: 40, seasonTemplate, nowMs: nowT }); // 100 -> 40, map B Round1 tụt còn 40/100
check('Round 1 reopen thành "active" sau khi sửa Entry làm tụt điểm dưới trần',
  db.prepare(`SELECT status FROM gym_round_status WHERE gym_season_id=? AND round_number=1`).get(gymSeasonId).status === 'active');
check('Round 2 tự động về lại "pending" (cascade)',
  db.prepare(`SELECT status FROM gym_round_status WHERE gym_season_id=? AND round_number=2`).get(gymSeasonId).status === 'pending');

section('TEST — Sửa lại Entry cho đủ điểm trần -> Round 1 completed lại, Round 2 active lại');
engine.editEntry(db, { entryId: entryB1.entryId, ticketsUsed: 1, pointsScored: 100, seasonTemplate, nowMs: nowT });
check('Round 1 completed trở lại', db.prepare(`SELECT status FROM gym_round_status WHERE gym_season_id=? AND round_number=1`).get(gymSeasonId).status === 'completed');
check('Round 2 active trở lại', engine.getActiveRoundNumber(db, gymSeasonId) === 2);

// ===================================================================
section('TEST — Sub-Admin XOÁ Entry của Round ĐÃ COMPLETED -> tự động reopen (quyết định mới)');
// ===================================================================
engine.deleteEntry(db, { entryId: entryB1.entryId });
check('Round 1 reopen "active" sau khi xoá Entry (map B mất hẳn điểm)',
  db.prepare(`SELECT status FROM gym_round_status WHERE gym_season_id=? AND round_number=1`).get(gymSeasonId).status === 'active');
check('Round 2 về lại "pending"',
  db.prepare(`SELECT status FROM gym_round_status WHERE gym_season_id=? AND round_number=2`).get(gymSeasonId).status === 'pending');

// Ghi lại để tiếp tục các test sau
engine.createEntry(db, { gymSeasonId, roundNumber: 1, mapId: mapB, memberId, ticketsUsed: 1, pointsScored: 100, seasonTemplate, nowMs: nowT });
check('Round 1 completed lại, sẵn sàng cho các test tiếp theo', engine.getActiveRoundNumber(db, gymSeasonId) === 2);

// ===================================================================
section('TEST — Combined Score + Banned member (giữ nguyên như bản trước)');
// ===================================================================
engine.createEntry(db, { gymSeasonId, roundNumber: 2, mapId: mapA, memberId, ticketsUsed: 1, pointsScored: 150, seasonTemplate, nowMs: nowT });
let combined = engine.calculateCombinedScore(db, gymSeasonId);
check('Combined Score = 350 (100+100 Round1 + 150 Round2)', combined === 350, `got ${combined}`);

engine.createEntry(db, { gymSeasonId, roundNumber: 2, mapId: mapB, memberId: memberBanned, ticketsUsed: 1, pointsScored: 50, seasonTemplate, nowMs: nowT });
db.prepare(`UPDATE members SET is_banned = 1, banned_at = datetime('now') WHERE id = ?`).run(memberBanned);
combined = engine.calculateCombinedScore(db, gymSeasonId);
check('Combined Score = 350 sau khi ban (trừ 50 của người banned, tiến độ map vẫn giữ)', combined === 350, `got ${combined}`);

err = null;
try {
  engine.createEntry(db, { gymSeasonId, roundNumber: 2, mapId: mapA, memberId: memberBanned, ticketsUsed: 1, pointsScored: 10, seasonTemplate, nowMs: nowT });
} catch (e) { err = e.message; }
check('Member banned không ghi được Entry mới', err && err.includes('khoá'), `got "${err}"`);

// ===================================================================
section('TEST — Ticket Regen (giữ nguyên như bản trước)');
// ===================================================================
check('Ngay lúc bắt đầu: 12 vé', engine.calculateTicketsGranted(seasonTemplate, battleStart.getTime()) === 12);
check('Sau 2 ngày: 18 vé', engine.calculateTicketsGranted(seasonTemplate, battleStart.getTime() + 2 * 86400000) === 18);
check('Sau 10 ngày: chạm trần 30 vé', engine.calculateTicketsGranted(seasonTemplate, battleStart.getTime() + 10 * 86400000) === 30);
check('Trước battle_start_at: 0 vé', engine.calculateTicketsGranted(seasonTemplate, battleStart.getTime() - 86400000) === 0);

// ===================================================================
section('TEST — getRoundConfig: round lặp (repeat_max_score cố định, KHÔNG cộng dồn)');
// ===================================================================
check('Round 4 (lặp) = 900', engine.getRoundConfig(db, seasonTemplate.id, 4).max_score === 900);
check('Round 10 (lặp xa) vẫn = 900', engine.getRoundConfig(db, seasonTemplate.id, 10).max_score === 900);

// ===================================================================
section('SETUP — Season B (KHÔNG có repeat_max_score, test "hoàn thành hết nội dung")');
// ===================================================================
const seasonB = makeSeason({ name: 'Season B', lastRound: 1, repeatMax: null, battleStart });
const mapC = db.prepare(`INSERT INTO season_template_maps (season_template_id, name, order_index) VALUES (?, 'Whitney', 1)`).run(seasonB.id).lastInsertRowid;
db.prepare(`INSERT INTO season_template_rounds (season_template_id, round_number, max_score, order_index) VALUES (?, 1, 50, 1)`).run(seasonB.id);

const gymId2 = db.prepare(`INSERT INTO gyms (name, slug, admin_code) VALUES ('Gym B', 'gym-b', 'codeB')`).run().lastInsertRowid;
const gymSeasonId2 = db.prepare(`INSERT INTO gym_seasons (gym_id, season_template_id) VALUES (?, ?)`).run(gymId2, seasonB.id).lastInsertRowid;
const memberId2 = db.prepare(`INSERT INTO members (gym_season_id, name) VALUES (?, 'SoloPlayer')`).run(gymSeasonId2).lastInsertRowid;
engine.recomputeRoundChain(db, gymSeasonId2);

section('TEST — Hoàn thành Round DUY NHẤT, không có repeat_max_score -> hasCompletedEverything = true');
check('Trước khi clear: hasCompletedEverything = false', engine.hasCompletedEverything(db, gymSeasonId2) === false);
engine.createEntry(db, { gymSeasonId: gymSeasonId2, roundNumber: 1, mapId: mapC, memberId: memberId2, ticketsUsed: 1, pointsScored: 50, seasonTemplate: seasonB, nowMs: nowT });
check('Sau khi clear Round 1 (round duy nhất): getActiveRoundNumber = null', engine.getActiveRoundNumber(db, gymSeasonId2) === null);
check('hasCompletedEverything = true', engine.hasCompletedEverything(db, gymSeasonId2) === true);

err = null;
try {
  engine.createEntry(db, { gymSeasonId: gymSeasonId2, roundNumber: 1, mapId: mapC, memberId: memberId2, ticketsUsed: 1, pointsScored: 5, seasonTemplate: seasonB, nowMs: nowT });
} catch (e) { err = e.message; }
check('Bị chặn ghi Entry mới khi đã hoàn thành hết nội dung', err && err.includes('hoàn thành toàn bộ'), `got "${err}"`);

// ===================================================================
section('TEST — editEntry: validation bổ sung (task cải tiến Master Admin UX)');
// ===================================================================
{
  // Setup riêng: 1 map, 1 round max_score=10, 1 entry ban đầu 2 điểm -> progress = 2
  const seasonC = makeSeason({ name: 'Season C', lastRound: 1, repeatMax: null, battleStart });
  const mapD = db.prepare(`INSERT INTO season_template_maps (season_template_id, name, order_index) VALUES (?, 'MapD', 1)`).run(seasonC.id).lastInsertRowid;
  db.prepare(`INSERT INTO season_template_rounds (season_template_id, round_number, max_score, order_index) VALUES (?, 1, 10, 1)`).run(seasonC.id);
  const gymIdC = db.prepare(`INSERT INTO gyms (name, slug, admin_code) VALUES ('Gym C', 'gym-c', 'codeC')`).run().lastInsertRowid;
  const gymSeasonIdC = db.prepare(`INSERT INTO gym_seasons (gym_id, season_template_id) VALUES (?, ?)`).run(gymIdC, seasonC.id).lastInsertRowid;
  const memberC = db.prepare(`INSERT INTO members (gym_season_id, name) VALUES (?, 'PlayerC')`).run(gymSeasonIdC).lastInsertRowid;
  const memberBannedC = db.prepare(`INSERT INTO members (gym_season_id, name) VALUES (?, 'PlayerC-Banned')`).run(gymSeasonIdC).lastInsertRowid;
  engine.recomputeRoundChain(db, gymSeasonIdC);

  const entryC = engine.createEntry(db, { gymSeasonId: gymSeasonIdC, roundNumber: 1, mapId: mapD, memberId: memberC, ticketsUsed: 1, pointsScored: 2, seasonTemplate: seasonC, nowMs: nowT });

  // Ví dụ đúng như task đưa ra: progress=2 (old=2), sửa old=2 -> new=8, max=10 => OK (progress mới = 0+8=8)
  engine.editEntry(db, { entryId: entryC.entryId, ticketsUsed: 1, pointsScored: 8, seasonTemplate: seasonC, nowMs: nowT });
  const progressAfterOk = db.prepare(`SELECT current_points FROM gym_round_map_progress WHERE gym_season_id=? AND round_number=1 AND season_template_map_id=?`).get(gymSeasonIdC, mapD).current_points;
  check('Edit points trong hạn mức (loại trừ giá trị cũ) -> progress cập nhật đúng = 8', progressAfterOk === 8);

  // Sửa tiếp lên 11 -> vượt trần 10 => REJECT, thông báo phải nêu rõ còn thiếu bao nhiêu (ở đây progress excluding = 0, còn thiếu 10)
  let errEdit = null;
  try {
    engine.editEntry(db, { entryId: entryC.entryId, ticketsUsed: 1, pointsScored: 11, seasonTemplate: seasonC, nowMs: nowT });
  } catch (e) { errEdit = e.message; }
  check('Edit points vượt max_score (đã loại trừ giá trị cũ) -> reject', errEdit && errEdit.includes('vượt trần'), `got "${errEdit}"`);
  check('Thông báo lỗi nêu rõ số điểm còn thiếu (theo pattern hiện có của createEntry)', errEdit && errEdit.includes('còn thiếu 10'), `got "${errEdit}"`);
  const progressUnchanged = db.prepare(`SELECT current_points FROM gym_round_map_progress WHERE gym_season_id=? AND round_number=1 AND season_template_map_id=?`).get(gymSeasonIdC, mapD).current_points;
  check('Edit bị reject -> progress KHÔNG bị thay đổi (vẫn = 8)', progressUnchanged === 8);

  // Ticket vượt remaining: granted lúc này = 12 (day1), đã dùng 1 vé cho entryC -> remaining = 11.
  // Sửa entryC lên tickets_used=13 -> vượt TICKET_MAX (3) trước cả khi chạm remaining -> vẫn phải reject (validate range trước)
  let errTicket = null;
  try {
    engine.editEntry(db, { entryId: entryC.entryId, ticketsUsed: 13, pointsScored: 8, seasonTemplate: seasonC, nowMs: nowT });
  } catch (e) { errTicket = e.message; }
  check('Edit tickets_used ngoài khoảng 1-3 -> reject', errTicket && errTicket.includes('vé phải là số nguyên'), `got "${errTicket}"`);

  // Entry của member ĐÃ BỊ BAN: PRD chỉ chặn CREATE mới (invariant #3), không có rule nào chặn EDIT/DELETE
  // entry lịch sử của member banned — do đó editEntry KHÔNG được tự ý thêm rule chặn ở đây (giữ đúng PRD).
  const entryBanned = engine.createEntry(db, { gymSeasonId: gymSeasonIdC, roundNumber: 1, mapId: mapD, memberId: memberBannedC, ticketsUsed: 1, pointsScored: 1, seasonTemplate: seasonC, nowMs: nowT });
  db.prepare(`UPDATE members SET is_banned = 1, banned_at = datetime('now') WHERE id = ?`).run(memberBannedC);
  let errBannedEdit = null;
  try {
    engine.editEntry(db, { entryId: entryBanned.entryId, ticketsUsed: 1, pointsScored: 1, seasonTemplate: seasonC, nowMs: nowT });
  } catch (e) { errBannedEdit = e.message; }
  check('Sửa Entry LỊCH SỬ của member đã bị banned vẫn được PHÉP (đúng PRD — chỉ chặn tạo Entry MỚI)', errBannedEdit === null, `got error "${errBannedEdit}"`);
}

// ===================================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`KẾT QUẢ: ${pass} PASS / ${fail} FAIL (tổng ${pass + fail} test)`);
console.log('='.repeat(50));
process.exit(fail > 0 ? 1 : 0);

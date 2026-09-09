const express = require('express');
const router = express.Router({ mergeParams: true });
router.param('id', require('../security/validation').idParam);
router.use(require('../security/validation').bodyValidation);
const engine = require('../engine');
const { resolveActiveGymSeason } = require('./helpers');

// req.body an toàn: mặc định {} nếu client không gửi Content-Type (giống bài học Phase 2)
router.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

// ===== Middleware: resolve slug -> req.gym (404 nếu không tồn tại/đã xoá) =====
router.use((req, res, next) => {
  const db = req.db;
  const gym = db.prepare('SELECT id,name,slug FROM gyms WHERE slug = ? AND deleted_at IS NULL').get(req.params.slug);
  if (!gym) return res.status(404).json({ error: 'Không tìm thấy Gym' });
  req.gym = gym;
  req.gymSeason = resolveActiveGymSeason(db, gym.id);
  req.seasonTemplate = req.gymSeason
    ? db.prepare('SELECT * FROM season_templates WHERE id = ?').get(req.gymSeason.season_template_id)
    : null;
  next();
});

// ===== Middleware: xác thực mã Admin của ĐÚNG Gym này =====
function requireGymAdmin(req, res, next) {
  if (!req.principal || req.principal.role !== 'gym' || req.principal.gym_id !== req.gym.id) {
    return res.status(403).json({ error: 'Không có quyền Admin Gym' });
  }
  next();
}


// ================= MEMBERS =================

router.get('/members', requireGymAdmin, (req, res) => {
  const db = req.db;
  if (!req.gymSeason) return res.json([]);
  const rows = db.prepare('SELECT * FROM members WHERE gym_season_id = ? ORDER BY name').all(req.gymSeason.id);
  res.json(rows);
});

router.post('/members/bulk', requireGymAdmin, (req, res) => {
  const db = req.db;
  if (!req.gymSeason) return res.status(400).json({ error: 'Gym chưa có Season nào active' });
  const members = Array.isArray(req.body.members) ? req.body.members : [];
  const valid = members.filter(m => m && m.name && m.name.trim());
  if (!valid.length) return res.json({ ok: true, created: 0 });

  const insert = db.prepare('INSERT OR IGNORE INTO members (gym_season_id, name, avatar_url) VALUES (?, ?, ?)');
  const txn = db.transaction((list) => {
    let count = 0;
    list.forEach(m => {
      const info = insert.run(req.gymSeason.id, m.name.trim(), m.avatar_url || '');
      if (info.changes) count++;
    });
    return count;
  });
  const created = txn(valid);
  res.json({ ok: true, created });
});

router.patch('/members/:id', requireGymAdmin, (req, res) => {
  const db = req.db;
  const member = db.prepare('SELECT * FROM members WHERE id = ? AND gym_season_id = ?').get(req.params.id, req.gymSeason?.id);
  if (!member) return res.status(404).json({ error: 'Thành viên không tồn tại' });
  const { name, avatar_url } = req.body;
  try {
    db.prepare('UPDATE members SET name = ?, avatar_url = ? WHERE id = ?')
      .run(name === undefined ? member.name : name.trim(), avatar_url ?? member.avatar_url, member.id);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Tên đã tồn tại trong mùa này' });
    throw e;
  }
});

router.patch('/members/:id/ban', requireGymAdmin, (req, res) => {
  const db = req.db;
  const member = db.prepare('SELECT * FROM members WHERE id = ? AND gym_season_id = ?').get(req.params.id, req.gymSeason?.id);
  if (!member) return res.status(404).json({ error: 'Thành viên không tồn tại' });
  const isBanned = !!req.body.is_banned;
  db.prepare(`UPDATE members SET is_banned = ?, banned_at = ? WHERE id = ?`)
    .run(isBanned ? 1 : 0, isBanned ? new Date().toISOString() : null, member.id);
  res.json({ ok: true });
});

// ================= ENTRIES (LOG) =================

router.get('/entries', requireGymAdmin, (req, res) => {
  const db = req.db;
  if (!req.gymSeason) return res.json([]);
  const rows = db.prepare(`
    SELECT e.*, m.name as member_name, mp.name as map_name, mp.image_url as map_image, mp.type_weakness as map_type
    FROM entries e
    JOIN members m ON e.member_id = m.id
    JOIN season_template_maps mp ON e.season_template_map_id = mp.id
    WHERE e.gym_season_id = ?
    ORDER BY e.created_at DESC
    LIMIT 300
  `).all(req.gymSeason.id);
  res.json(rows);
});

router.post('/entries', requireGymAdmin, (req, res) => {
  const db = req.db;
  if (!req.gymSeason || !req.seasonTemplate) return res.status(400).json({ error: 'Gym chưa có Season nào active' });

  const { member_id, map_id, tickets_used, points_scored } = req.body;
  if (!member_id || !map_id || tickets_used == null || points_scored == null) {
    return res.status(400).json({ error: 'Thiếu dữ liệu' });
  }
  const member = db.prepare('SELECT is_banned FROM members WHERE id=? AND gym_season_id=?').get(member_id, req.gymSeason.id);
  const map = db.prepare('SELECT id FROM season_template_maps WHERE id=? AND season_template_id=?').get(map_id, req.seasonTemplate.id);
  if (!member || !map) return res.status(404).json({ error: 'Thành viên hoặc Map không thuộc mùa này' });
  if (member.is_banned) return res.status(403).json({ error: 'Thành viên đã bị khóa' });

  // Round luôn xác định phía server (không tin client gửi round_number) — tránh spoof
  const activeRoundNumber = engine.getActiveRoundNumber(db, req.gymSeason.id);
  if (activeRoundNumber == null) {
    const msg = engine.hasCompletedEverything(db, req.gymSeason.id)
      ? 'Đã hoàn thành toàn bộ nội dung hiện có của mùa này, không thể nhập thêm'
      : 'Chưa có Round nào đang active';
    return res.status(400).json({ error: msg });
  }

  try {
    const result = engine.createEntry(db, {
      gymSeasonId: req.gymSeason.id,
      roundNumber: activeRoundNumber,
      mapId: Number(map_id),
      memberId: Number(member_id),
      ticketsUsed: Number(tickets_used),
      pointsScored: Number(points_scored),
      seasonTemplate: req.seasonTemplate,
      nowMs: Date.now(),
    });
    res.json({ ok: true, entry_id: result.entryId, round_number: activeRoundNumber, trace: result.trace });
  } catch (e) {
    throw e;
  }
});

router.patch('/entries/:id', requireGymAdmin, (req, res) => {
  const db = req.db;
  const entry = db.prepare('SELECT * FROM entries WHERE id = ? AND gym_season_id = ?').get(req.params.id, req.gymSeason?.id);
  if (!entry) return res.status(404).json({ error: 'Không tìm thấy lượt chơi' });

  try {
    const result = engine.editEntry(db, {
      entryId: entry.id,
      ticketsUsed: req.body.tickets_used != null ? Number(req.body.tickets_used) : undefined,
      pointsScored: req.body.points_scored != null ? Number(req.body.points_scored) : undefined,
      seasonTemplate: req.seasonTemplate,
      nowMs: Date.now(),
    });
    res.json({ ok: true, trace: result.trace });
  } catch (e) {
    throw e;
  }
});

router.delete('/entries/:id', requireGymAdmin, (req, res) => {
  const db = req.db;
  const entry = db.prepare('SELECT * FROM entries WHERE id = ? AND gym_season_id = ?').get(req.params.id, req.gymSeason?.id);
  if (!entry) return res.status(404).json({ error: 'Không tìm thấy lượt chơi' });

  try {
    const result = engine.deleteEntry(db, { entryId: entry.id });
    res.json({ ok: true, trace: result.trace });
  } catch (e) {
    throw e;
  }
});

// ================= SEASON SWITCH =================

// Xem trước: có Season mới không, và roster hiện tại (đã loại banned) để hiển thị bước "Copy"
router.get('/season-switch/preview', requireGymAdmin, (req, res) => {
  const db = req.db;
  const globalActiveTemplate = db.prepare('SELECT * FROM season_templates WHERE is_active = 1').get();
  if (!globalActiveTemplate) return res.json({ hasNewSeason: false });

  const hasNewSeason = !req.gymSeason || req.gymSeason.season_template_id !== globalActiveTemplate.id;
  let rosterToCopy = [];
  if (req.gymSeason) {
    rosterToCopy = db.prepare(`
      SELECT name, avatar_url FROM members WHERE gym_season_id = ? AND is_banned = 0 ORDER BY name
    `).all(req.gymSeason.id);
  }
  res.json({ hasNewSeason, newSeasonName: globalActiveTemplate.name, rosterToCopy });
});

router.post('/season-switch', requireGymAdmin, (req, res) => {
  const db = req.db;
  const globalActiveTemplate = db.prepare('SELECT * FROM season_templates WHERE is_active = 1').get();
  if (!globalActiveTemplate) return res.status(400).json({ error: 'Chưa có Season Template nào đang active' });

  const members = Array.isArray(req.body.members) ? req.body.members.filter(m => m && m.name && m.name.trim()) : [];

  const txn = db.transaction(() => {
    if (req.gymSeason) {
      db.prepare('UPDATE gym_seasons SET is_active = 0 WHERE id = ?').run(req.gymSeason.id);
    }
    const info = db.prepare('INSERT INTO gym_seasons (gym_id, season_template_id, is_active) VALUES (?, ?, 1)')
      .run(req.gym.id, globalActiveTemplate.id);
    const newGymSeasonId = info.lastInsertRowid;

    const insertMember = db.prepare('INSERT INTO members (gym_season_id, name, avatar_url) VALUES (?, ?, ?)');
    members.forEach(m => insertMember.run(newGymSeasonId, m.name.trim(), m.avatar_url || ''));

    return newGymSeasonId;
  });
  const newGymSeasonId = txn();

  engine.recomputeRoundChain(db, newGymSeasonId); // khởi tạo Round 1 = active ngay
  res.json({ ok: true, gym_season_id: newGymSeasonId, season_template: globalActiveTemplate.name });
});

module.exports = router;

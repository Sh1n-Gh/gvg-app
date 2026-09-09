const express = require('express');
const router = require('../security/lifecycle').trackedRouter(express.Router());
router.param('id', require('../security/validation').idParam);
const engine = require('../engine');
const { slugify, exportSeasonSnapshot } = require('./helpers');
const { randomBytes } = require('node:crypto');

const { hashPassword } = require('../auth/password');

// Danh sách Pokemon Type hợp lệ — PHẢI khớp với public/pokemon-types.js (POKEMON_TYPES).
// Backend/frontend không chia sẻ module (frontend là static script thuần, không bundler),
// nên danh sách key được lặp lại có chủ đích ở đây để validate server-side (defense in depth,
// tránh bypass dropdown bằng cách gọi thẳng API). Nếu sửa danh sách type, phải sửa cả 2 nơi.
const VALID_POKEMON_TYPES = new Set([
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison',
  'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
]);

function requireMasterAdmin(req, res, next) {
  if (!req.principal || req.principal.role !== 'master') return res.sendStatus(401);
  next();
}

const { MAX_BYTES: MAP_IMAGE_MAX_BYTES } = require('../security/map-images');
const parseMapImageBody = express.raw({ type: ['image/png', 'image/jpeg'], limit: MAP_IMAGE_MAX_BYTES, inflate: false });

// Route upload phải đứng trước middleware gán req.body={} để express.raw có thể đọc body.
router.post('/map-images', requireMasterAdmin, (req, res, next) => {
  parseMapImageBody(req, res, err => {
    if (!err) return next();
    const message = err.type === 'entity.too.large'
      ? 'Ảnh vượt quá giới hạn 5 MB'
      : 'Không đọc được file ảnh';
    return res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: message });
  });
}, async (req, res, next) => {
  try {
    const image_url = await req.app.locals.mapImages.save(req.body);
    res.json({ ok: true, image_url });
  } catch (err) {
    next(err);
  }
});

// req.body có thể undefined nếu client không gửi Content-Type (VD: PATCH /activate không cần body).
// Mặc định về {} thay vì chặn cứng — để logic validate riêng từng route tự báo lỗi field nào thiếu.
router.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

router.use(requireMasterAdmin);
router.use(require('../security/validation').bodyValidation);


// ============ SEASON TEMPLATES ============

router.get('/season-templates', (req, res) => {
  const db = req.db;
  const rows = db.prepare('SELECT * FROM season_templates ORDER BY created_at DESC').all();
  const withCount = rows.map(s => {
    const gymCount = db.prepare(`
      SELECT COUNT(DISTINCT gym_id) c FROM gym_seasons WHERE season_template_id = ? AND is_active = 1
    `).get(s.id).c;
    return { ...s, gym_count: gymCount };
  });
  res.json(withCount);
});

router.get('/season-templates/:id', (req, res) => {
  const db = req.db;
  const season = db.prepare('SELECT * FROM season_templates WHERE id = ?').get(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season Template không tồn tại' });
  const maps = db.prepare('SELECT * FROM season_template_maps WHERE season_template_id = ? ORDER BY order_index').all(season.id);
  const rounds = db.prepare('SELECT * FROM season_template_rounds WHERE season_template_id = ? ORDER BY round_number').all(season.id);
  res.json({ season, maps, rounds });
});

// Chuẩn hoá về đúng key enum lowercase (đã validate hợp lệ ở validateSeasonPayload trước khi hàm này được gọi);
// rỗng/null -> lưu chuỗi rỗng, giữ nguyên convention hiện có của cột (TEXT, không NULL constraint chặt).
function normalizeTypeWeakness(raw) {
  if (!raw) return '';
  return String(raw).trim().toLowerCase();
}

function validateSeasonPayload(body) {
  const { name, maps, rounds, ticket_config } = body;
  if (!name || !name.trim()) return 'Tên Season bắt buộc';
  if (!Array.isArray(maps) || !maps.filter(m => m && m.name && m.name.trim()).length) {
    return 'Cần ít nhất 1 map có tên hợp lệ';
  }
  for (const m of maps) {
    if (!m || !m.name || !m.name.trim()) continue; // map rỗng bị lọc bỏ ở bước insert, không cần validate type ở đây
    if (m.type_weakness && !VALID_POKEMON_TYPES.has(String(m.type_weakness).trim().toLowerCase())) {
      return `Type Weakness không hợp lệ cho map "${m.name}": "${m.type_weakness}" (phải là 1 trong 18 Pokemon Type, hoặc để trống)`;
    }
  }
  if (!Array.isArray(rounds) || !rounds.length) return 'Cần ít nhất 1 Round';
  for (const r of rounds) {
    if (!Number.isInteger(r.round_number) || r.round_number < 1) return `round_number không hợp lệ: ${r.round_number}`;
    if (!Number.isFinite(Number(r.max_score)) || Number(r.max_score) <= 0) return `max_score Round ${r.round_number} phải là số dương`;
  }
  const roundNumbers = rounds.map(r => r.round_number);
  if (new Set(roundNumbers).size !== roundNumbers.length) return 'round_number bị trùng';
  if (!ticket_config || !ticket_config.battle_start_at) return 'Cần cấu hình vé (battle_start_at bắt buộc)';
  if (!Number.isFinite(Number(ticket_config.day1_amount)) || Number(ticket_config.day1_amount) < 0) return 'ticket day1_amount không hợp lệ';
  if (!Number.isFinite(Number(ticket_config.daily_amount)) || Number(ticket_config.daily_amount) < 0) return 'ticket daily_amount không hợp lệ';
  if (!Number.isInteger(ticket_config.regen_days) || ticket_config.regen_days < 0) return 'ticket regen_days không hợp lệ';
  return null;
}

router.post('/season-templates', (req, res) => {
  const db = req.db;
  const err = validateSeasonPayload(req.body);
  if (err) return res.status(400).json({ error: err });

  const { name, maps, rounds, ticket_config } = req.body;
  if (maps.some(m => m.id !== undefined)) return res.status(400).json({ error: 'Map mới không nhận ID' });
  const lastDefinedRoundNumber = Math.max(...rounds.map(r => r.round_number));
  const repeatMaxScore = Number(rounds.reduce((last, round) =>
    round.round_number > last.round_number ? round : last
  ).max_score);

  const txn = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO season_templates
        (name, is_active, last_defined_round_number, repeat_max_score, battle_start_at,
         ticket_day1_amount, ticket_daily_amount, ticket_regen_days)
      VALUES (?, 0, ?, ?, ?, ?, ?, ?)
    `).run(
      name.trim(), lastDefinedRoundNumber, repeatMaxScore, ticket_config.battle_start_at,
      Number(ticket_config.day1_amount), Number(ticket_config.daily_amount), Number(ticket_config.regen_days)
    );
    const seasonId = info.lastInsertRowid;

    const insertMap = db.prepare(`
      INSERT INTO season_template_maps (season_template_id, name, type_weakness, image_url, note, order_index)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    maps.filter(m => m.name && m.name.trim()).forEach((m, i) => {
      insertMap.run(seasonId, m.name.trim(), normalizeTypeWeakness(m.type_weakness), m.image_url || '', m.note || '', i + 1);
    });

    const insertRound = db.prepare(`
      INSERT INTO season_template_rounds (season_template_id, round_number, max_score, order_index)
      VALUES (?, ?, ?, ?)
    `);
    rounds.forEach((r, i) => insertRound.run(seasonId, r.round_number, Number(r.max_score), i + 1));

    return seasonId;
  });

  const seasonId = txn();
  const snapshotFile = exportSeasonSnapshot(db, seasonId);
  res.json({ ok: true, season_template_id: seasonId, snapshot_file: snapshotFile });
});

router.patch('/season-templates/:id', (req, res) => {
  const db = req.db;
  const season = db.prepare('SELECT * FROM season_templates WHERE id = ?').get(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season Template không tồn tại' });

  const err = validateSeasonPayload(req.body);
  if (err) return res.status(400).json({ error: err });

  const { name, maps, rounds, ticket_config } = req.body;
  const ownedMapIds = new Set(db.prepare('SELECT id FROM season_template_maps WHERE season_template_id=?').all(season.id).map(m => m.id));
  if (maps.some(m => m.id !== undefined && !ownedMapIds.has(m.id))) return res.status(404).json({ error: 'Map không thuộc Season Template' });
  const lastDefinedRoundNumber = Math.max(...rounds.map(r => r.round_number));
  const repeatMaxScore = Number(rounds.reduce((last, round) =>
    round.round_number > last.round_number ? round : last
  ).max_score);

  // Kiểm tra trước: có Gym active nào đang dùng template này không -> để trả cảnh báo cho client tự confirm trước khi gọi (client-side dialog),
  // ở đây API vẫn thực hiện (client đã confirm trước khi gửi request PATCH)
  const affectedGymSeasonIds = db.prepare(`
    SELECT id FROM gym_seasons WHERE season_template_id = ? AND is_active = 1
  `).all(season.id).map(r => r.id);

  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE season_templates SET name=?, last_defined_round_number=?, repeat_max_score=?,
        battle_start_at=?, ticket_day1_amount=?, ticket_daily_amount=?, ticket_regen_days=?
      WHERE id=?
    `).run(
      name.trim(), lastDefinedRoundNumber, repeatMaxScore, ticket_config.battle_start_at,
      Number(ticket_config.day1_amount), Number(ticket_config.daily_amount), Number(ticket_config.regen_days),
      season.id
    );

    // ⚠️ Map KHÔNG được xoá/tạo lại — season_template_map_id đang được entries/gym_round_map_progress
    // tham chiếu qua Foreign Key. Chỉ UPDATE tại chỗ theo id; map không có id = map mới (chỉ cho thêm, không xoá).
    const existingMapIds = db.prepare('SELECT id FROM season_template_maps WHERE season_template_id = ?').all(season.id).map(r => r.id);
    const updateMap = db.prepare(`
      UPDATE season_template_maps SET name=?, type_weakness=?, image_url=?, note=?, order_index=?
      WHERE id=? AND season_template_id=?
    `);
    const insertMap = db.prepare(`
      INSERT INTO season_template_maps (season_template_id, name, type_weakness, image_url, note, order_index)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    maps.filter(m => m.name && m.name.trim()).forEach((m, i) => {
      if (m.id && existingMapIds.includes(m.id)) {
        updateMap.run(m.name.trim(), normalizeTypeWeakness(m.type_weakness), m.image_url || '', m.note || '', i + 1, m.id, season.id);
      } else {
        insertMap.run(season.id, m.name.trim(), normalizeTypeWeakness(m.type_weakness), m.image_url || '', m.note || '', i + 1);
      }
    });

    db.prepare('DELETE FROM season_template_rounds WHERE season_template_id = ?').run(season.id);
    const insertRound = db.prepare(`
      INSERT INTO season_template_rounds (season_template_id, round_number, max_score, order_index)
      VALUES (?, ?, ?, ?)
    `);
    rounds.forEach((r, i) => insertRound.run(season.id, r.round_number, Number(r.max_score), i + 1));
  });
  txn();

  // Recompute lại cho mọi gym_season ĐANG ACTIVE dùng template này (mùa cũ đã đóng băng thì không đụng)
  for (const gsId of affectedGymSeasonIds) {
    engine.recomputeRoundChain(db, gsId);
  }

  const snapshotFile = exportSeasonSnapshot(db, season.id);
  res.json({ ok: true, affected_gym_seasons: affectedGymSeasonIds.length, snapshot_file: snapshotFile });
});

router.patch('/season-templates/:id/activate', (req, res) => {
  const db = req.db;
  const season = db.prepare('SELECT * FROM season_templates WHERE id = ?').get(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season Template không tồn tại' });

  db.prepare('UPDATE season_templates SET is_active = 0').run();
  db.prepare('UPDATE season_templates SET is_active = 1 WHERE id = ?').run(season.id);
  res.json({ ok: true });
});

// ============ GYMS ============

router.get('/gyms', (req, res) => {
  const db = req.db;
  const includeDeleted = req.query.include_deleted === '1';
  const rows = includeDeleted
    ? db.prepare('SELECT id,name,slug,contact_info,deleted_at,created_at FROM gyms ORDER BY created_at DESC').all()
    : db.prepare('SELECT id,name,slug,contact_info,deleted_at,created_at FROM gyms WHERE deleted_at IS NULL ORDER BY created_at DESC').all();
  res.json(rows);
});

router.get('/gyms/check-slug', (req, res) => {
  const db = req.db;
  const slug = slugify(req.query.slug || '');
  const exists = db.prepare('SELECT id FROM gyms WHERE slug = ?').get(slug); // check cả gym đã xoá (giữ chỗ slug)
  res.json({ slug, available: !exists });
});

router.post('/gyms', async (req, res) => {
  const db = req.db;
  const { name } = req.body;
  let { slug } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Tên Gym bắt buộc' });
  slug = slugify(slug || name);
  if (!slug || slug.length > 100) return res.status(400).json({ error: 'Slug không hợp lệ' });

  const slugTaken = db.prepare('SELECT id FROM gyms WHERE slug = ?').get(slug);
  if (slugTaken) return res.status(409).json({ error: `Slug "${slug}" đã tồn tại` });

  const activeTemplate = db.prepare('SELECT * FROM season_templates WHERE is_active = 1').get();
  if (!activeTemplate) return res.status(400).json({ error: 'Chưa có Season Template nào đang active' });

  const temporaryPassword = randomBytes(32).toString('base64url');
  // Independent, non-authenticating placeholder for the legacy NOT NULL UNIQUE column.
  const tombstone = `disabled:${randomBytes(32).toString('hex')}`;
  let passwordHash;
  try {
    passwordHash = await hashPassword(temporaryPassword);
  } catch {
    return res.status(400).json({ error: 'Không thể tạo credential Gym' });
  }
  // Hash asynchronously before starting SQLite's synchronous transaction; all writes are atomic.
  const txn = db.transaction(() => {
    const gymInfo = db.prepare('INSERT INTO gyms (name, slug, admin_code) VALUES (?, ?, ?)').run(name.trim(), slug, tombstone);
    const gymId = gymInfo.lastInsertRowid;
    db.prepare("INSERT INTO auth_principals(role,gym_id,password_hash,must_rotate) VALUES ('gym',?,?,1)").run(gymId, passwordHash);
    const gsInfo = db.prepare('INSERT INTO gym_seasons (gym_id, season_template_id) VALUES (?, ?)').run(gymId, activeTemplate.id);
    // Include Round 1 initialization so a failure cannot leave a partially created Gym.
    engine.recomputeRoundChain(db, gsInfo.lastInsertRowid);
    return { gymId, gymSeasonId: gsInfo.lastInsertRowid };
  });
  let created;
  try { created = txn(); }
  catch { return res.status(409).json({ error: 'Không thể tạo Gym; dữ liệu chưa được ghi' }); }
  const { gymId } = created;

  res.set('Cache-Control', 'no-store').json({
    ok: true,
    gym: {
      id: gymId, name: name.trim(), slug,
      // One-time temporary password; retain the existing response key for the Master UI.
      admin_code: temporaryPassword,
      dashboard_url: `/g/${slug}`,
      admin_url: `/g/${slug}/admin`,
      season_template: activeTemplate.name,
    },
  });
});

router.patch('/gyms/:id/slug', (req, res) => {
  const db = req.db;
  const gym = db.prepare('SELECT id FROM gyms WHERE id = ?').get(req.params.id);
  if (!gym) return res.status(404).json({ error: 'Gym không tồn tại' });

  const newSlug = slugify(req.body.slug || '');
  if (!newSlug) return res.status(400).json({ error: 'Slug không hợp lệ' });
  const taken = db.prepare('SELECT id FROM gyms WHERE slug = ? AND id != ?').get(newSlug, gym.id);
  if (taken) return res.status(409).json({ error: `Slug "${newSlug}" đã tồn tại` });

  db.prepare('UPDATE gyms SET slug = ? WHERE id = ?').run(newSlug, gym.id);
  res.json({ ok: true, slug: newSlug });
});

router.patch('/gyms/:id/delete', (req, res) => {
  const db = req.db;
  const gym = db.prepare('SELECT id FROM gyms WHERE id = ?').get(req.params.id);
  if (!gym) return res.status(404).json({ error: 'Gym không tồn tại' });
  db.prepare(`UPDATE gyms SET deleted_at = datetime('now') WHERE id = ?`).run(gym.id);
  res.json({ ok: true });
});

router.patch('/gyms/:id/restore', (req, res) => {
  const db = req.db;
  const gym = db.prepare('SELECT id FROM gyms WHERE id = ?').get(req.params.id);
  if (!gym) return res.status(404).json({ error: 'Gym không tồn tại' });
  db.prepare('UPDATE gyms SET deleted_at = NULL WHERE id = ?').run(gym.id);
  res.json({ ok: true });
});

// ============ GYM REQUESTS (stub — nối đầy đủ ở Phase 7) ============
router.get('/gym-requests', (req, res) => {
  const db = req.db;
  const status = req.query.status || 'pending';
  const rows = db.prepare('SELECT * FROM gym_requests WHERE status = ? ORDER BY created_at DESC').all(status);
  res.json(rows);
});

module.exports = router;

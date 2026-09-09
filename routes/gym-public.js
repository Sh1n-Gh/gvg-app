const express = require('express');
const router = express.Router({ mergeParams: true });
router.param('id', require('../security/validation').idParam);
const engine = require('../engine');
const { resolveActiveGymSeason } = require('./helpers');

// ===== Middleware: resolve slug -> req.gym (404 nếu không tồn tại/đã xoá) =====
router.use((req, res, next) => {
  const db = req.db;
  const gym = db.prepare('SELECT * FROM gyms WHERE slug = ? AND deleted_at IS NULL').get(req.params.slug);
  if (!gym) return res.status(404).json({ error: 'Không tìm thấy Gym' });
  req.gym = gym;
  next();
});

// ===== Helper dùng chung: build state của 1 gym_season cụ thể (dùng cho cả /state hiện tại và Season Archive) =====
function buildGymSeasonState(db, gymSeason) {
  const seasonTemplate = db.prepare('SELECT * FROM season_templates WHERE id = ?').get(gymSeason.season_template_id);
  const maps = db.prepare('SELECT * FROM season_template_maps WHERE season_template_id = ? ORDER BY order_index').all(seasonTemplate.id);

  const activeRoundNumber = engine.getActiveRoundNumber(db, gymSeason.id);
  const hasCompletedEverything = engine.hasCompletedEverything(db, gymSeason.id);

  // Round để hiển thị lên lưới map: round đang active, hoặc round cuối cùng đã completed nếu đã hết nội dung
  let displayRoundNumber = activeRoundNumber;
  if (displayRoundNumber == null && hasCompletedEverything) {
    const lastCompleted = db.prepare(`
      SELECT MAX(round_number) m FROM gym_round_status WHERE gym_season_id = ? AND status = 'completed'
    `).get(gymSeason.id);
    displayRoundNumber = lastCompleted.m;
  }

  let displayRoundConfig = null;
  let mapRows = maps.map(m => ({ ...m, current_points: 0, status: 'open', round_progress_pct: 0 }));

  if (displayRoundNumber != null) {
    displayRoundConfig = engine.getRoundConfig(db, seasonTemplate.id, displayRoundNumber);
    mapRows = maps.map(m => {
      const progress = db.prepare(`
        SELECT current_points FROM gym_round_map_progress
        WHERE gym_season_id = ? AND round_number = ? AND season_template_map_id = ?
      `).get(gymSeason.id, displayRoundNumber, m.id);
      const currentPoints = progress ? progress.current_points : 0;
      const status = currentPoints >= displayRoundConfig.max_score ? 'ended' : 'open';
      return {
        ...m,
        current_points: currentPoints,
        status,
        round_progress_pct: engine.roundProgressPct(currentPoints, displayRoundConfig.max_score),
      };
    });
  }

  const members = db.prepare('SELECT * FROM members WHERE gym_season_id = ? ORDER BY name').all(gymSeason.id);
  const now = Date.now();
  const membersWithTickets = members.map(m => {
    const totalPoints = db.prepare(`
      SELECT COALESCE(SUM(points_scored), 0) as total FROM entries WHERE gym_season_id = ? AND member_id = ?
    `).get(gymSeason.id, m.id).total;
    return {
      ...m,
      tickets_granted: engine.calculateTicketsGranted(seasonTemplate, now),
      tickets_remaining: engine.ticketsRemaining(db, gymSeason.id, m.id, seasonTemplate, now),
      total_points_scored: totalPoints,
    };
  });

  const combinedScore = engine.calculateCombinedScore(db, gymSeason.id);
  const totalTicketsRemaining = membersWithTickets.reduce((sum, m) => sum + Math.max(0, m.tickets_remaining), 0);

  return {
    season: { id: seasonTemplate.id, name: seasonTemplate.name },
    gym_season: { id: gymSeason.id, is_active: !!gymSeason.is_active, created_at: gymSeason.created_at },
    active_round: activeRoundNumber != null
      ? { round_number: activeRoundNumber, max_score: engine.getRoundConfig(db, seasonTemplate.id, activeRoundNumber).max_score }
      : null,
    display_round_number: displayRoundNumber,
    has_completed_everything: hasCompletedEverything,
    maps: mapRows,
    members: membersWithTickets,
    summary: { combined_score: combinedScore, total_tickets_remaining: totalTicketsRemaining },
  };
}

// ===== GET /g/:slug/state — Dashboard hiện tại =====
router.get('/state', (req, res) => {
  const db = req.db;
  const gymSeason = resolveActiveGymSeason(db, req.gym.id);
  if (!gymSeason) {
    return res.json({
      gym: { name: req.gym.name, slug: req.gym.slug },
      season: null, active_round: null, has_completed_everything: false,
      maps: [], members: [], summary: { combined_score: 0, total_tickets_remaining: 0 },
    });
  }
  const state = buildGymSeasonState(db, gymSeason);
  res.json({ gym: { name: req.gym.name, slug: req.gym.slug }, ...state });
});

// ===== GET /g/:slug/seasons — danh sách các mùa Gym đã tham gia (Season Archive) =====
router.get('/seasons', (req, res) => {
  const db = req.db;
  const rows = db.prepare(`
    SELECT gs.id, gs.is_active, gs.created_at, st.name as season_name
    FROM gym_seasons gs
    JOIN season_templates st ON gs.season_template_id = st.id
    WHERE gs.gym_id = ?
    ORDER BY gs.created_at DESC
  `).all(req.gym.id);

  const withScore = rows.map(r => ({
    ...r,
    combined_score: engine.calculateCombinedScore(db, r.id),
  }));
  res.json(withScore);
});

// ===== GET /g/:slug/seasons/:id/state — xem lại 1 mùa cụ thể (view-only, kể cả mùa đang active) =====
router.get('/seasons/:id/state', (req, res) => {
  const db = req.db;
  const gymSeason = db.prepare('SELECT * FROM gym_seasons WHERE id = ? AND gym_id = ?').get(req.params.id, req.gym.id);
  if (!gymSeason) return res.status(404).json({ error: 'Không tìm thấy mùa này của Gym' });

  const state = buildGymSeasonState(db, gymSeason);
  res.json({ gym: { name: req.gym.name, slug: req.gym.slug }, ...state });
});

// ===== GET /g/:slug/overview — ma trận điểm Member × Map và vé Round × Map =====
router.get('/overview', (req, res) => {
  const db = req.db;
  const gymSeason = resolveActiveGymSeason(db, req.gym.id);
  if (!gymSeason) return res.json({ maps: [], members: [], rounds: [], score_cells: [], ticket_cells: [] });

  const maps = db.prepare(`
    SELECT id, name, type_weakness, image_url, order_index
    FROM season_template_maps
    WHERE season_template_id = ?
    ORDER BY order_index
  `).all(gymSeason.season_template_id);
  const members = db.prepare(`
    SELECT m.id, m.name, m.avatar_url, m.is_banned,
           COALESCE(SUM(e.points_scored), 0) AS total_points
    FROM members m
    LEFT JOIN entries e ON e.member_id = m.id AND e.gym_season_id = m.gym_season_id
    WHERE m.gym_season_id = ?
    GROUP BY m.id
    ORDER BY total_points DESC, m.name COLLATE NOCASE ASC
  `).all(gymSeason.id);
  const scoreCells = db.prepare(`
    SELECT member_id, season_template_map_id AS map_id, SUM(points_scored) AS total_points
    FROM entries
    WHERE gym_season_id = ?
    GROUP BY member_id, season_template_map_id
  `).all(gymSeason.id);
  const ticketEntries = db.prepare(`
    SELECT e.round_number, e.season_template_map_id AS map_id, e.tickets_used
    FROM entries e
    JOIN season_template_maps mp ON mp.id = e.season_template_map_id
    WHERE e.gym_season_id = ?
    ORDER BY e.round_number, mp.order_index, e.created_at, e.id
  `).all(gymSeason.id);

  const definedRounds = db.prepare(`
    SELECT round_number FROM season_template_rounds
    WHERE season_template_id = ?
    ORDER BY round_number
  `).all(gymSeason.season_template_id).map(row => row.round_number);
  const roundNumbers = new Set(definedRounds);
  ticketEntries.forEach(entry => roundNumbers.add(entry.round_number));
  const activeRoundNumber = engine.getActiveRoundNumber(db, gymSeason.id);
  if (activeRoundNumber != null) roundNumbers.add(activeRoundNumber);

  const ticketCellsByKey = new Map();
  ticketEntries.forEach(entry => {
    const key = `${entry.round_number}:${entry.map_id}`;
    if (!ticketCellsByKey.has(key)) {
      ticketCellsByKey.set(key, { round_number: entry.round_number, map_id: entry.map_id, tickets: [] });
    }
    ticketCellsByKey.get(key).tickets.push(entry.tickets_used);
  });

  res.json({
    maps,
    members,
    rounds: [...roundNumbers].sort((a, b) => a - b),
    score_cells: scoreCells,
    ticket_cells: [...ticketCellsByKey.values()],
  });
});

// ===== GET /g/:slug/leaderboard — bảng xếp hạng đóng góp (mùa đang active) =====
router.get('/leaderboard', (req, res) => {
  const db = req.db;
  const gymSeason = resolveActiveGymSeason(db, req.gym.id);
  if (!gymSeason) return res.json([]);

  const seasonTemplate = db.prepare('SELECT * FROM season_templates WHERE id = ?').get(gymSeason.season_template_id);
  const now = Date.now();
  const ticketsGranted = engine.calculateTicketsGranted(seasonTemplate, now);
  const ticketsUntilEventEnd = seasonTemplate.ticket_day1_amount
    + seasonTemplate.ticket_daily_amount * seasonTemplate.ticket_regen_days;

  const rows = db.prepare(`
    SELECT m.id, m.name, m.avatar_url, m.is_banned,
           COALESCE(SUM(e.points_scored), 0) as total_points,
           COALESCE(SUM(e.tickets_used), 0) as tickets_used
    FROM members m
    LEFT JOIN entries e ON e.member_id = m.id
    WHERE m.gym_season_id = ?
    GROUP BY m.id
    ORDER BY m.is_banned ASC, total_points DESC, m.name COLLATE NOCASE ASC
  `).all(gymSeason.id);

  const leaderboard = rows.map(row => ({
    ...row,
    tickets_granted: ticketsGranted,
    tickets_remaining: Math.max(0, engine.ticketsRemaining(db, gymSeason.id, row.id, seasonTemplate, now)),
    tickets_future: Math.max(0, ticketsUntilEventEnd - ticketsGranted),
    average_points_per_ticket: row.tickets_used > 0 ? row.total_points / row.tickets_used : 0,
  }));
  res.json(leaderboard);
});

// ===== GET /g/:slug/log — lịch sử lượt chơi (view-only, mùa đang active) =====
router.get('/log', (req, res) => {
  const db = req.db;
  const gymSeason = resolveActiveGymSeason(db, req.gym.id);
  if (!gymSeason) return res.json([]);

  const rows = db.prepare(`
    SELECT e.id, e.member_id, e.season_template_map_id,
           e.round_number, e.tickets_used, e.points_scored, e.created_at, e.updated_at,
           m.name as member_name, m.avatar_url as member_avatar,
           mp.name as map_name, mp.image_url as map_avatar
    FROM entries e
    JOIN members m ON e.member_id = m.id
    JOIN season_template_maps mp ON e.season_template_map_id = mp.id
    WHERE e.gym_season_id = ?
    ORDER BY e.created_at DESC
    LIMIT 300
  `).all(gymSeason.id);
  res.json(rows);
});

module.exports = router;

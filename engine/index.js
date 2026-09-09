const { PublicError } = require('../security/errors');
// ===== ENGINE LÕI — theo PRD-FINAL.md mục 3 =====
// Toàn bộ hàm nhận `db` (better-sqlite3 instance) làm tham số đầu để dễ test độc lập.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// --- 3.1 getRoundConfig ---
function getRoundConfig(db, seasonTemplateId, roundNumber) {
  const defined = db.prepare(`
    SELECT round_number, max_score FROM season_template_rounds
    WHERE season_template_id = ? AND round_number = ?
  `).get(seasonTemplateId, roundNumber);
  if (defined) return defined;

  const template = db.prepare('SELECT * FROM season_templates WHERE id = ?').get(seasonTemplateId);
  if (!template) return null;

  if (roundNumber > template.last_defined_round_number && template.repeat_max_score != null) {
    return { round_number: roundNumber, max_score: template.repeat_max_score };
  }
  return null;
}

// --- 3.2 recomputeRoundChain ---
function recomputeRoundChain(db, gymSeasonId) {
  const gymSeason = db.prepare('SELECT * FROM gym_seasons WHERE id = ?').get(gymSeasonId);
  const seasonTemplateId = gymSeason.season_template_id;
  const maps = db.prepare('SELECT id FROM season_template_maps WHERE season_template_id = ?').all(seasonTemplateId);

  const upsertStatus = db.prepare(`
    INSERT INTO gym_round_status (gym_season_id, round_number, status) VALUES (?, ?, ?)
    ON CONFLICT(gym_season_id, round_number) DO UPDATE SET status = excluded.status
  `);

  let roundNumber = 1;
  let foundActive = false;
  const trace = []; // để test dễ theo dõi

  while (true) {
    const config = getRoundConfig(db, seasonTemplateId, roundNumber);
    if (!config) break;

    const allCleared = maps.every(m => {
      const row = db.prepare(`
        SELECT current_points FROM gym_round_map_progress
        WHERE gym_season_id = ? AND round_number = ? AND season_template_map_id = ?
      `).get(gymSeasonId, roundNumber, m.id);
      const points = row ? row.current_points : 0;
      return points >= config.max_score;
    });

    let status;
    if (allCleared) {
      status = 'completed';
    } else if (!foundActive) {
      status = 'active';
      foundActive = true;
    } else {
      status = 'pending';
      upsertStatus.run(gymSeasonId, roundNumber, status);
      trace.push({ round_number: roundNumber, status });
      break;
    }
    upsertStatus.run(gymSeasonId, roundNumber, status);
    trace.push({ round_number: roundNumber, status });
    roundNumber++;
  }

  return trace;
}

// --- 3.3 calculateTicketsGranted (per-member) ---
function calculateTicketsGranted(seasonTemplate, nowMs) {
  const startMs = new Date(seasonTemplate.battle_start_at).getTime();
  if (nowMs < startMs) return 0;
  const elapsedDays = Math.min(
    Math.floor((nowMs - startMs) / ONE_DAY_MS),
    seasonTemplate.ticket_regen_days
  );
  return seasonTemplate.ticket_day1_amount + seasonTemplate.ticket_daily_amount * elapsedDays;
}

// --- 3.4 ticketsRemaining ---
function ticketsRemaining(db, gymSeasonId, memberId, seasonTemplate, nowMs) {
  const granted = calculateTicketsGranted(seasonTemplate, nowMs);
  const used = db.prepare(`
    SELECT COALESCE(SUM(tickets_used), 0) as used FROM entries
    WHERE gym_season_id = ? AND member_id = ?
  `).get(gymSeasonId, memberId).used;
  return granted - used;
}

// --- 3.5 calculateCombinedScore ---
function calculateCombinedScore(db, gymSeasonId) {
  const total = db.prepare(`
    SELECT COALESCE(SUM(current_points), 0) as total FROM gym_round_map_progress
    WHERE gym_season_id = ?
  `).get(gymSeasonId).total;

  const bannedDeduction = db.prepare(`
    SELECT COALESCE(SUM(e.points_scored), 0) as total
    FROM entries e
    JOIN members m ON e.member_id = m.id
    WHERE e.gym_season_id = ? AND m.is_banned = 1
  `).get(gymSeasonId).total;

  return total - bannedDeduction;
}

// --- 3.6 round_progress_pct ---
function roundProgressPct(currentPoints, roundMaxScore) {
  if (roundMaxScore <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((currentPoints / roundMaxScore) * 100)));
}

const TICKET_MIN = 1;
const TICKET_MAX = 3;

// --- Helper: lấy round_number đang active của 1 gym_season (null nếu không có) ---
function getActiveRoundNumber(db, gymSeasonId) {
  const row = db.prepare(`
    SELECT round_number FROM gym_round_status WHERE gym_season_id = ? AND status = 'active'
  `).get(gymSeasonId);
  return row ? row.round_number : null;
}

// --- Helper: đã hoàn thành TOÀN BỘ nội dung khả dụng chưa (hết round, không có repeat) ---
function hasCompletedEverything(db, gymSeasonId) {
  const gymSeason = db.prepare('SELECT * FROM gym_seasons WHERE id = ?').get(gymSeasonId);
  const activeRoundNumber = getActiveRoundNumber(db, gymSeasonId);
  if (activeRoundNumber != null) return false; // vẫn còn round active -> chưa xong

  const anyCompleted = db.prepare(`
    SELECT COUNT(*) c FROM gym_round_status WHERE gym_season_id = ? AND status = 'completed'
  `).get(gymSeasonId).c > 0;
  if (!anyCompleted) return false; // chưa từng bắt đầu, không phải "đã xong"

  return true; // có round completed nhưng không còn round nào active -> đã hết nội dung
}

// --- Helper dùng chung: ghi nhận 1 Entry MỚI (chỉ cho phép ở round đang active) ---
function createEntry(db, { gymSeasonId, roundNumber, mapId, memberId, ticketsUsed, pointsScored, seasonTemplate, nowMs }) {
  if (!Number.isInteger(ticketsUsed) || ticketsUsed < TICKET_MIN || ticketsUsed > TICKET_MAX) {
    throw new PublicError(`Số vé phải là số nguyên từ ${TICKET_MIN}-${TICKET_MAX}`);
  }
  if (!Number.isInteger(pointsScored) || pointsScored <= 0) {
    throw new PublicError('Điểm đạt được phải là số nguyên dương');
  }

  const activeRoundNumber = getActiveRoundNumber(db, gymSeasonId);
  if (activeRoundNumber == null) {
    if (hasCompletedEverything(db, gymSeasonId)) {
      throw new PublicError('Đã hoàn thành toàn bộ nội dung hiện có của mùa này, không thể nhập thêm');
    }
    throw new PublicError('Chưa có Round nào đang active');
  }
  if (roundNumber !== activeRoundNumber) {
    throw new PublicError(`Chỉ có thể ghi điểm cho Round đang active (Round ${activeRoundNumber}), không thể ghi cho Round ${roundNumber}`);
  }

  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  if (!member) throw new PublicError('Thành viên không tồn tại');
  if (member.is_banned) throw new PublicError('Thành viên đã bị khoá, không thể ghi điểm mới');

  const remaining = ticketsRemaining(db, gymSeasonId, memberId, seasonTemplate, nowMs);
  if (ticketsUsed > remaining) throw new PublicError(`Không đủ vé. Còn lại: ${remaining}`);

  const roundConfig = getRoundConfig(db, seasonTemplate.id, roundNumber);
  if (!roundConfig) throw new PublicError('Round không tồn tại/chưa có cấu hình');

  const progressRow = db.prepare(`
    SELECT * FROM gym_round_map_progress WHERE gym_season_id = ? AND round_number = ? AND season_template_map_id = ?
  `).get(gymSeasonId, roundNumber, mapId);
  const currentPoints = progressRow ? progressRow.current_points : 0;
  const newTotal = currentPoints + pointsScored;
  if (newTotal > roundConfig.max_score) {
    throw new PublicError(`Điểm vượt trần Round (còn thiếu ${roundConfig.max_score - currentPoints} pts)`);
  }

  const txn = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO entries (gym_season_id, round_number, season_template_map_id, member_id, tickets_used, points_scored)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(gymSeasonId, roundNumber, mapId, memberId, ticketsUsed, pointsScored);

    db.prepare(`
      INSERT INTO gym_round_map_progress (gym_season_id, round_number, season_template_map_id, current_points)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(gym_season_id, round_number, season_template_map_id) DO UPDATE SET current_points = excluded.current_points
    `).run(gymSeasonId, roundNumber, mapId, newTotal);

    return info.lastInsertRowid;
  });
  const entryId = txn();

  const trace = recomputeRoundChain(db, gymSeasonId);
  return { entryId, trace };
}

// --- Sửa 1 Entry đã tồn tại — CHO PHÉP kể cả Round đã completed, tự cascade reopen nếu cần ---
function editEntry(db, { entryId, ticketsUsed, pointsScored, seasonTemplate, nowMs }) {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(entryId);
  if (!entry) throw new PublicError('Không tìm thấy lượt chơi');

  const newTickets = ticketsUsed ?? entry.tickets_used;
  const newPoints = pointsScored ?? entry.points_scored;
  if (!Number.isInteger(newTickets) || newTickets < TICKET_MIN || newTickets > TICKET_MAX) {
    throw new PublicError(`Số vé phải là số nguyên từ ${TICKET_MIN}-${TICKET_MAX}`);
  }
  if (!Number.isInteger(newPoints) || newPoints <= 0) {
    throw new PublicError('Điểm đạt được phải là số nguyên dương');
  }

  // Vé còn lại phải tính LOẠI TRỪ giá trị cũ của chính entry này trước khi so sánh
  const remainingExcludingThis = ticketsRemaining(db, entry.gym_season_id, entry.member_id, seasonTemplate, nowMs) + entry.tickets_used;
  if (newTickets > remainingExcludingThis) {
    throw new PublicError(`Không đủ vé. Còn lại (không tính lượt này): ${remainingExcludingThis}`);
  }

  const roundConfig = getRoundConfig(db, seasonTemplate.id, entry.round_number);
  if (!roundConfig) throw new PublicError('Round của lượt chơi này không còn cấu hình hợp lệ');

  const progressRow = db.prepare(`
    SELECT * FROM gym_round_map_progress WHERE gym_season_id = ? AND round_number = ? AND season_template_map_id = ?
  `).get(entry.gym_season_id, entry.round_number, entry.season_template_map_id);
  const currentPoints = progressRow ? progressRow.current_points : 0;
  const progressExcludingThis = currentPoints - entry.points_scored;
  const newTotal = progressExcludingThis + newPoints;
  if (newTotal > roundConfig.max_score) {
    // Cùng dạng thông báo với createEntry: cho biết chính xác còn thiếu bao nhiêu điểm (đã loại trừ giá trị cũ của entry đang sửa)
    throw new PublicError(`Điểm vượt trần Round (còn thiếu ${roundConfig.max_score - progressExcludingThis} pts)`);
  }

  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE entries SET tickets_used = ?, points_scored = ?, updated_at = datetime('now') WHERE id = ?
    `).run(newTickets, newPoints, entryId);
    db.prepare(`
      INSERT INTO gym_round_map_progress (gym_season_id, round_number, season_template_map_id, current_points)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(gym_season_id, round_number, season_template_map_id) DO UPDATE SET current_points = excluded.current_points
    `).run(entry.gym_season_id, entry.round_number, entry.season_template_map_id, Math.max(0, newTotal));
  });
  txn();

  const trace = recomputeRoundChain(db, entry.gym_season_id);
  return { trace };
}

// --- Xoá 1 Entry — CHO PHÉP kể cả Round đã completed, tự cascade reopen nếu cần ---
function deleteEntry(db, { entryId }) {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(entryId);
  if (!entry) throw new PublicError('Không tìm thấy lượt chơi');

  const progressRow = db.prepare(`
    SELECT * FROM gym_round_map_progress WHERE gym_season_id = ? AND round_number = ? AND season_template_map_id = ?
  `).get(entry.gym_season_id, entry.round_number, entry.season_template_map_id);
  const currentPoints = progressRow ? progressRow.current_points : 0;
  const newTotal = Math.max(0, currentPoints - entry.points_scored);

  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE gym_round_map_progress SET current_points = ?
      WHERE gym_season_id = ? AND round_number = ? AND season_template_map_id = ?
    `).run(newTotal, entry.gym_season_id, entry.round_number, entry.season_template_map_id);
    db.prepare('DELETE FROM entries WHERE id = ?').run(entryId);
  });
  txn();

  const trace = recomputeRoundChain(db, entry.gym_season_id);
  return { trace };
}

// Acquire the writer reservation before reading balances/progress. Validation,
// entry mutation, progress and round-chain updates commit or roll back together.
// No async work may be placed inside these synchronous transactions.
function atomicEntryMutation(mutate) {
  return (db, args) => db.transaction(() => mutate(db, args)).immediate();
}

module.exports = {
  getRoundConfig,
  recomputeRoundChain,
  calculateTicketsGranted,
  ticketsRemaining,
  calculateCombinedScore,
  roundProgressPct,
  createEntry: atomicEntryMutation(createEntry),
  editEntry: atomicEntryMutation(editEntry),
  deleteEntry: atomicEntryMutation(deleteEntry),
  getActiveRoundNumber,
  hasCompletedEverything,
};

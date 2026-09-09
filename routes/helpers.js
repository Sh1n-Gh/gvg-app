const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateAdminCode() {
  const rand = () => crypto.randomBytes(2).toString('hex');
  return `${rand()}-${rand()}-${rand()}`;
}

// Bỏ dấu tiếng Việt + chuẩn hoá thành slug hợp lệ (chữ thường, số, dấu gạch ngang)
function slugify(input) {
  return input
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // bỏ dấu
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SEASON_CONFIG_DIR = path.join(__dirname, '..', 'season-configs');

function exportSeasonSnapshot(db, seasonTemplateId) {
  const season = db.prepare('SELECT * FROM season_templates WHERE id = ?').get(seasonTemplateId);
  const maps = db.prepare('SELECT name, type_weakness, image_url, note FROM season_template_maps WHERE season_template_id = ? ORDER BY order_index').all(seasonTemplateId);
  const rounds = db.prepare('SELECT round_number, max_score FROM season_template_rounds WHERE season_template_id = ? ORDER BY round_number').all(seasonTemplateId);

  const snapshot = {
    id: season.id,
    name: season.name,
    last_defined_round_number: season.last_defined_round_number,
    repeat_max_score: season.repeat_max_score,
    ticket_config: {
      battle_start_at: season.battle_start_at,
      day1_amount: season.ticket_day1_amount,
      daily_amount: season.ticket_daily_amount,
      regen_days: season.ticket_regen_days,
    },
    maps,
    rounds,
    exported_at: new Date().toISOString(),
  };

  if (!fs.existsSync(SEASON_CONFIG_DIR)) fs.mkdirSync(SEASON_CONFIG_DIR, { recursive: true });
  const filename = `${season.id}-${slugify(season.name)}.json`;
  fs.writeFileSync(path.join(SEASON_CONFIG_DIR, filename), JSON.stringify(snapshot, null, 2));
  return filename;
}

function resolveActiveGymSeason(db, gymId) {
  return db.prepare('SELECT * FROM gym_seasons WHERE gym_id = ? AND is_active = 1').get(gymId);
}

module.exports = { generateAdminCode, slugify, exportSeasonSnapshot, resolveActiveGymSeason };

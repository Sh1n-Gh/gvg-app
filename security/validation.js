const { PublicError } = require('./errors');
const { slugify } = require('../routes/helpers');
const bad = field => { throw new PublicError(`Dữ liệu không hợp lệ: ${field}`); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function string(v, field, max, empty = false) {
  if (typeof v !== 'string' || !v.isWellFormed() || v.length > max || /[\u0000-\u001f\u007f]/.test(v) || (!empty && !v.trim())) bad(field);
}
function integer(v, field, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) bad(field);
}
function idParam(req, res, next, value) {
  if (!/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) return res.status(400).json({ error: 'ID không hợp lệ' });
  next();
}
function slugParam(req, res, next, value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 100) return res.status(400).json({ error: 'Slug không hợp lệ' });
  next();
}
function url(v, field) {
  string(v, field, 2048, true);
  if (!v) return;
  if (/[\s<>"'`\\]/.test(v) || v.startsWith('//')) bad(field);
  try {
    const parsed = new URL(v, 'https://local.invalid/');
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) bad(field);
  } catch { bad(field); }
}
function member(m) {
  if (!object(m)) bad('member');
  string(m.name, 'name', 120);
  if (m.avatar_url !== undefined) url(m.avatar_url, 'avatar_url');
}
function season(body) {
  string(body.name, 'name', 120);
  if (!Array.isArray(body.maps) || !body.maps.length || body.maps.length > 100) bad('maps');
  const ids = new Set();
  for (const m of body.maps) {
    if (!object(m)) bad('map');
    string(m.name, 'map.name', 120);
    if (m.id !== undefined) { integer(m.id, 'map.id'); if (ids.has(m.id)) bad('map.id'); ids.add(m.id); }
    if (m.image_url !== undefined) url(m.image_url, 'image_url');
    if (m.note !== undefined) {
      if (typeof m.note !== 'string' || m.note.length > 2000 || !m.note.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(m.note)) bad('note');
    }
    if (m.type_weakness !== undefined) string(m.type_weakness, 'Type Weakness', 20, true);
  }
  if (!Array.isArray(body.rounds) || !body.rounds.length || body.rounds.length > 100) bad('rounds');
  const numbers = new Set();
  for (const r of body.rounds) {
    if (!object(r)) bad('round');
    integer(r.round_number, 'round_number', 1, 100);
    integer(r.max_score, 'max_score', 1, 1e9);
    if (numbers.has(r.round_number)) bad('round_number'); numbers.add(r.round_number);
  }
  // The engine walks rounds from 1; gaps would create ambiguous repeat rounds.
  if (Math.max(...numbers) !== numbers.size) bad('round_number');
  const t = body.ticket_config;
  if (!object(t)) bad('ticket_config');
  string(t.battle_start_at, 'battle_start_at', 30);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(t.battle_start_at) || !Number.isFinite(Date.parse(t.battle_start_at)) || new Date(t.battle_start_at).toISOString().replace('.000Z', 'Z') !== t.battle_start_at.replace('.000Z', 'Z')) bad('battle_start_at');
  integer(t.day1_amount, 'day1_amount', 0, 10000);
  integer(t.daily_amount, 'daily_amount', 0, 10000);
  integer(t.regen_days, 'regen_days', 0, 366);
}
function bodyValidation(req, res, next) {
  try {
    const b = req.body ?? {};
    if (!object(b)) bad('body');
    // Match Express's default case-insensitive, optional trailing-slash routing.
    const p = req.path.toLowerCase().replace(/\/+$/, '');
    if (['POST', 'PATCH'].includes(req.method)) {
      if (/^\/season-templates(?:\/\d+)?$/.test(p)) season(b);
      if (p === '/gyms' && req.method === 'POST') string(b.name, 'name', 120);
      if (b.slug !== undefined) { string(b.slug, 'slug', 100); if (!slugify(b.slug) || slugify(b.slug).length > 100) bad('slug'); }
      if (b.admin_code !== undefined) string(b.admin_code, 'admin_code', 256);
      if (p === '/members/bulk' || p === '/season-switch') {
        if (!Array.isArray(b.members) || b.members.length > 500) bad('members');
        b.members.forEach(member);
        const names = b.members.map(m => m.name.trim());
        if (new Set(names).size !== names.length) throw new PublicError('Tên thành viên bị trùng', 409);
      }
      if (/^\/members\/\d+$/.test(p)) {
        if (b.name !== undefined) string(b.name, 'name', 120);
        if (b.avatar_url !== undefined) url(b.avatar_url, 'avatar_url');
      }
      if (/^\/members\/\d+\/ban$/.test(p) && typeof b.is_banned !== 'boolean') bad('is_banned');
      if (/^\/entries(?:\/\d+)?$/.test(p)) {
        if (req.method === 'POST') { integer(b.member_id, 'member_id'); integer(b.map_id, 'map_id'); }
        if (req.method === 'POST' || b.tickets_used !== undefined) integer(b.tickets_used, 'tickets_used', 1, 3);
        if (req.method === 'POST' || b.points_scored !== undefined) integer(b.points_scored, 'points_scored', 1, 1e9);
        if (b.round_number !== undefined) integer(b.round_number, 'round_number', 1, 100);
      }
    }
    if (p === '/gyms/check-slug') string(req.query.slug, 'slug', 100);
    if (req.query.include_deleted !== undefined && !['0', '1'].includes(req.query.include_deleted)) bad('include_deleted');
    if (req.query.status !== undefined && !['pending', 'approved', 'rejected'].includes(req.query.status)) bad('status');
    next();
  } catch (err) { next(err); }
}
module.exports = { bodyValidation, idParam, slugParam, season, url };

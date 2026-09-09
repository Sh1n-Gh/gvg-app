const slug = window.location.pathname.split('/')[2];
let state = null;

function fmt(n) { return Number(n).toLocaleString('en-US'); }
function fmtAverage(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
}
// Only for text and quoted attributes, never script/style or URL validation.
function dashboardEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function dashboardImageUrl(value) {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f<>"'`\\]/.test(value)) return '';
  try {
    const url = new URL(value, window.location.href);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function dashboardNode(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function avatarHtml(url, fallback, cls) {
  const safeUrl = dashboardImageUrl(url);
  const node = dashboardNode(safeUrl ? 'img' : 'div', safeUrl ? cls : cls + ' avatar-fallback');
  if (safeUrl) { node.src = safeUrl; node.alt = ''; }
  else node.textContent = fallback || '?';
  return node.outerHTML;
}
function dashboardProgress(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}
function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr.replace(' ', 'T') + 'Z').getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}
async function api(path) {
  const res = await fetch(`/g/${slug}${path}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Có lỗi xảy ra');
  return data;
}

document.querySelectorAll('#public-tabs > .tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('#public-tabs > .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('main > .public-tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'leaderboard') loadLeaderboard();
    if (btn.dataset.tab === 'log') loadLog();
    if (btn.dataset.tab === 'seasons') loadSeasons();
  };
});

async function loadState() {
  try {
    state = await api('/state');
  } catch (e) {
    document.getElementById('gym-name').textContent = 'Không tìm thấy Gym';
    document.getElementById('season-name').textContent = e.message;
    return;
  }
  document.getElementById('gym-name').textContent = state.gym.name;
  document.getElementById('season-name').textContent = state.season ? state.season.name : 'Chưa tham gia mùa nào';
  renderDashboard();
  await loadOverview();
}

function renderDashboard() {
  document.getElementById('completed-banner').classList.toggle('hidden', !state.has_completed_everything);
  document.getElementById('round-chip').textContent = state.active_round
    ? `Round ${state.active_round.round_number} — trần ${fmt(state.active_round.max_score)} pts`
    : (state.has_completed_everything ? 'Đã hoàn thành' : 'Chưa có Round');
  document.getElementById('combined-score').textContent = fmt(state.summary?.combined_score || 0);
  document.getElementById('tickets-left').textContent = fmt(state.summary?.total_tickets_remaining || 0);

  const grid = document.getElementById('map-grid');
  if (!state.maps || !state.maps.length) {
    grid.innerHTML = '<p class="muted">Gym chưa tham gia mùa nào.</p>';
    return;
  }
  grid.replaceChildren(...state.maps.map(m => {
    const isEnded = m.status === 'ended';
    const card = dashboardNode('div', 'map-card ' + (isEnded ? 'ended' : ''));
    const avatar = dashboardNode('div', 'map-card-avatar');
    const safeUrl = dashboardImageUrl(m.image_url);
    if (safeUrl) {
      const img = dashboardNode('img'); img.src = safeUrl; img.alt = ''; avatar.append(img);
    } else avatar.textContent = '❔';
    card.append(avatar, dashboardNode('div', 'map-card-name', m.name));
    const type = normalizePokemonType(m.type_weakness);
    if (type) {
      const info = POKEMON_TYPE_MAP[type];
      const icon = dashboardNode('img', 'type-icon');
      icon.src = info.icon; icon.alt = icon.title = info.label; card.append(icon);
    }
    const track = dashboardNode('div', 'game-bar-track');
    const fill = dashboardNode('div', 'game-bar-fill ' + (isEnded ? 'full' : ''));
    fill.style.width = dashboardProgress(m.round_progress_pct) + '%';
    track.append(fill);
    card.append(track, dashboardNode('div', 'map-card-score', fmt(m.current_points) + ' pts'));
    return card;
  }));
}

function overviewMapHeaderHtml(map) {
  return `<div class="overview-map-header">
    ${avatarHtml(map.image_url, map.name[0], 'avatar-md')}
    <span>${dashboardEscape(map.name)}</span>
    ${pokemonTypeIconHtml(map.type_weakness)}
  </div>`;
}

function scoreHeatStyle(value, maxValue) {
  if (!value || !maxValue) return '';
  const intensity = Math.sqrt(value / maxValue);
  const lightness = Math.round(93 - intensity * 55);
  const textColor = lightness < 57 ? '#ffffff' : '#0b1739';
  return `style="background:hsl(214,82%,${lightness}%);color:${textColor};"`;
}

function renderScoreOverview(data) {
  const container = document.getElementById('score-overview');
  if (!data.maps.length || !data.members.length) {
    container.innerHTML = '<p class="muted">Chưa có dữ liệu thành viên/Map.</p>';
    return;
  }

  const scores = new Map(data.score_cells.map(cell => [`${cell.member_id}:${cell.map_id}`, Number(cell.total_points)]));
  const maxCellScore = Math.max(0, ...scores.values());
  const mapTotals = new Map(data.maps.map(map => [map.id, 0]));

  const memberRows = data.members.map(member => {
    let memberTotal = 0;
    const cells = data.maps.map(map => {
      const score = scores.get(`${member.id}:${map.id}`) || 0;
      memberTotal += score;
      mapTotals.set(map.id, mapTotals.get(map.id) + score);
      return `<td class="overview-score-cell" ${scoreHeatStyle(score, maxCellScore)} title="${dashboardEscape(member.name)} · ${dashboardEscape(map.name)}: ${fmt(score)} pts">${score ? fmt(score) : '—'}</td>`;
    }).join('');
    return `<tr class="${member.is_banned ? 'overview-banned-row' : ''}">
      <th scope="row" class="overview-row-header">
        ${avatarHtml(member.avatar_url, member.name[0], 'avatar-sm')}
        <span class="overview-member-name" title="${dashboardEscape(member.name)}">${dashboardEscape(member.name)}</span>
        ${member.is_banned ? '<span class="badge-banned">🚫</span>' : ''}
      </th>
      ${cells}
      <td class="overview-total-cell">${fmt(memberTotal)}</td>
    </tr>`;
  }).join('');

  const mapTotalCells = data.maps.map(map => `<td class="overview-total-cell">${fmt(mapTotals.get(map.id))}</td>`).join('');
  container.innerHTML = `<table class="overview-table score-overview-table">
    <thead><tr>
      <th class="overview-corner">Thành viên</th>
      ${data.maps.map(map => `<th scope="col">${overviewMapHeaderHtml(map)}</th>`).join('')}
      <th scope="col" class="overview-total-heading">Tổng</th>
    </tr></thead>
    <tbody>${memberRows}</tbody>
    <tfoot><tr><th scope="row" class="overview-row-header">Tổng Map</th>${mapTotalCells}<td class="overview-grand-total">${fmt([...mapTotals.values()].reduce((sum, value) => sum + value, 0))}</td></tr></tfoot>
  </table>`;
}

function renderTicketOverview(data) {
  const container = document.getElementById('ticket-overview');
  if (!data.maps.length || !data.rounds.length) {
    container.innerHTML = '<p class="muted">Chưa có dữ liệu Round/Map.</p>';
    return;
  }

  const ticketsByCell = new Map(data.ticket_cells.map(cell => [`${cell.round_number}:${cell.map_id}`, cell.tickets]));
  const mapTotals = new Map(data.maps.map(map => [map.id, 0]));
  const roundRows = data.rounds.map(roundNumber => {
    let roundTotal = 0;
    const cells = data.maps.map(map => {
      const tickets = ticketsByCell.get(`${roundNumber}:${map.id}`) || [];
      const total = tickets.reduce((sum, value) => sum + Number(value), 0);
      roundTotal += total;
      mapTotals.set(map.id, mapTotals.get(map.id) + total);
      return `<td class="overview-ticket-cell" title="Round ${dashboardEscape(roundNumber)} · ${dashboardEscape(map.name)}: ${total} vé">${tickets.length ? dashboardEscape(tickets.join('-')) : '—'}</td>`;
    }).join('');
    return `<tr><th scope="row" class="overview-row-header overview-round-header">Round ${dashboardEscape(roundNumber)}</th>${cells}<td class="overview-total-cell">${fmt(roundTotal)}</td></tr>`;
  }).join('');

  const mapTotalCells = data.maps.map(map => `<td class="overview-total-cell">${fmt(mapTotals.get(map.id))}</td>`).join('');
  container.innerHTML = `<table class="overview-table ticket-overview-table">
    <thead><tr>
      <th class="overview-corner">Round</th>
      ${data.maps.map(map => `<th scope="col">${overviewMapHeaderHtml(map)}</th>`).join('')}
      <th scope="col" class="overview-total-heading">Tổng vé</th>
    </tr></thead>
    <tbody>${roundRows}</tbody>
    <tfoot><tr><th scope="row" class="overview-row-header">Tổng Map</th>${mapTotalCells}<td class="overview-grand-total">${fmt([...mapTotals.values()].reduce((sum, value) => sum + value, 0))}</td></tr></tfoot>
  </table>`;
}

async function loadOverview() {
  const scoreContainer = document.getElementById('score-overview');
  const ticketContainer = document.getElementById('ticket-overview');
  try {
    const data = await api('/overview');
    renderScoreOverview(data);
    renderTicketOverview(data);
  } catch (error) {
    for (const container of [scoreContainer, ticketContainer]) {
      container.replaceChildren(dashboardNode('p', 'msg error', '⚠️ Không tải được overview: ' + error.message));
    }
  }
}

async function loadLeaderboard() {
  const list = document.getElementById('leaderboard-list');
  const rows = await api('/leaderboard');
  let rank = 0;
  list.innerHTML = rows.map(r => {
    if (!r.is_banned) rank++;
    return `
      <div class="list-row leaderboard-row ${r.is_banned ? 'banned' : ''}">
        <div class="leaderboard-member">
          <span class="rank">${r.is_banned ? '—' : `#${rank}`}</span>
          ${avatarHtml(r.avatar_url, r.name[0], 'avatar-md')}
          <div class="leaderboard-member-copy">
            <div class="leaderboard-name">${dashboardEscape(r.name)}</div>
            ${r.is_banned ? '<span class="badge-banned">🚫 Đã khoá · Không xếp hạng</span>' : ''}
          </div>
        </div>
        <div class="leaderboard-details">
          <div class="leaderboard-score">
            <span class="leaderboard-score-label">Tổng điểm</span>
            <strong class="leaderboard-score-value">${fmt(r.total_points)}</strong>
            <span class="leaderboard-average" aria-label="Điểm / vé: ${fmtAverage(r.average_points_per_ticket)}">Trung bình / vé <strong>${fmtAverage(r.average_points_per_ticket)}</strong></span>
          </div>
          <div class="leaderboard-tickets">
            <span class="leaderboard-ticket-heading">🎫 Thông tin vé</span>
            <div class="leaderboard-ticket-list">
              <span class="leaderboard-ticket" aria-label="Vé đã cấp: ${fmt(r.tickets_granted)}"><small><span class="ticket-label-wide">Đã cấp</span><span class="ticket-label-short">Cấp</span></small><strong>${fmt(r.tickets_granted)}</strong></span>
              <span class="leaderboard-ticket" aria-label="Vé đã dùng: ${fmt(r.tickets_used)}"><small><span class="ticket-label-wide">Đã dùng</span><span class="ticket-label-short">Dùng</span></small><strong>${fmt(r.tickets_used)}</strong></span>
              <span class="leaderboard-ticket ticket-remaining" aria-label="Vé còn lại: ${fmt(r.tickets_remaining)}"><small><span class="ticket-label-wide">Còn lại</span><span class="ticket-label-short">Còn</span></small><strong>${fmt(r.tickets_remaining)}</strong></span>
              <span class="leaderboard-ticket ticket-future" aria-label="Vé sẽ nhận thêm: ${fmt(r.tickets_future)}"><small><span class="ticket-label-wide">Sẽ nhận thêm</span><span class="ticket-label-short">+</span></small><strong>${fmt(r.tickets_future)}</strong><small class="ticket-future-suffix"> sẽ nhận</small></span>
            </div>
          </div>
        </div>
      </div>`;
  }).join('') || '<p class="muted">Chưa có dữ liệu.</p>';
}

let publicLogRowsCache = [];

function setPublicLogFilterOptions(selectId, placeholder, options) {
  const select = document.getElementById(selectId);
  const previousValue = select.value;
  select.replaceChildren(...[{ value: '', label: placeholder }, ...options].map(option => {
    const node = dashboardNode('option', '', option.label);
    node.value = option.value;
    return node;
  }));
  if ([...select.options].some(option => option.value === previousValue)) select.value = previousValue;
}

function populatePublicLogFilters() {
  const membersById = new Map();
  const mapsById = new Map();
  const roundNumbers = new Set();
  publicLogRowsCache.forEach(row => {
    membersById.set(String(row.member_id), row.member_name);
    mapsById.set(String(row.season_template_map_id), row.map_name);
    roundNumbers.add(Number(row.round_number));
  });
  setPublicLogFilterOptions('public-log-filter-member', 'Tất cả thành viên',
    [...membersById].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'vi')));
  setPublicLogFilterOptions('public-log-filter-round', 'Tất cả Round',
    [...roundNumbers].sort((a, b) => a - b).map(round => ({ value: String(round), label: `Round ${round}` })));
  setPublicLogFilterOptions('public-log-filter-map', 'Tất cả Map',
    [...mapsById].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'vi')));
}

function renderPublicLog() {
  const list = document.getElementById('log-list');
  if (!publicLogRowsCache.length) {
    document.getElementById('public-log-filter-summary').textContent = '';
    list.innerHTML = '<p class="muted">Chưa có lượt chơi nào.</p>';
    return;
  }
  const rows = filterAdminLogRows(publicLogRowsCache, {
    memberId: document.getElementById('public-log-filter-member').value,
    roundNumber: document.getElementById('public-log-filter-round').value,
    mapId: document.getElementById('public-log-filter-map').value,
  });
  document.getElementById('public-log-filter-summary').textContent =
    `Hiển thị ${fmt(rows.length)}/${fmt(publicLogRowsCache.length)} lượt`;
  list.innerHTML = rows.map(r => `
    <div class="log-card">
      <div class="log-card-left">
        ${avatarHtml(r.member_avatar, r.member_name[0], 'avatar-md')}
        <div><div class="log-member-name">${dashboardEscape(r.member_name)}</div><div class="log-time">${timeAgo(r.created_at)}</div></div>
      </div>
      <span class="round-chip small">Round ${dashboardEscape(r.round_number)}</span>
      <div class="log-map">${avatarHtml(r.map_avatar, r.map_name[0], 'avatar-md')}<div class="log-map-name">${dashboardEscape(r.map_name)}</div></div>
      <div class="log-tickets">🎫 ×${dashboardEscape(r.tickets_used)}</div>
      <div class="log-score">
        <span class="log-score-label">Score Obtained</span>
        <span class="log-score-value">${fmt(r.points_scored)}</span>
        <span class="log-score-unit">pts</span>
      </div>
    </div>`).join('') || '<p class="muted">Không có lượt chơi phù hợp với bộ lọc.</p>';
}

async function loadLog() {
  publicLogRowsCache = await api('/log');
  populatePublicLogFilters();
  renderPublicLog();
}

['public-log-filter-member', 'public-log-filter-round', 'public-log-filter-map'].forEach(id => {
  document.getElementById(id).onchange = renderPublicLog;
});
document.getElementById('public-log-filter-reset').onclick = () => {
  document.getElementById('public-log-filter-member').value = '';
  document.getElementById('public-log-filter-round').value = '';
  document.getElementById('public-log-filter-map').value = '';
  renderPublicLog();
};

async function loadSeasons() {
  const list = document.getElementById('seasons-list');
  const rows = await api('/seasons');
  list.innerHTML = rows.map(r => `
    <div class="list-row">
      <span>${dashboardEscape(r.season_name)} ${r.is_active ? '<span class="round-chip small">Đang chơi</span>' : ''}</span>
      <span class="sub">${fmt(r.combined_score)} pts</span>
    </div>`).join('') || '<p class="muted">Chưa tham gia mùa nào.</p>';
}

loadState();
setInterval(loadState, 15000);

window.refreshGymOverview = loadState;
if (window.location.hash === '#admin') {
  document.querySelector('#public-tabs > [data-tab="admin"]').click();
}

(() => {
const slug = window.location.pathname.split('/')[2];
const sessionClient = createSessionClient({ prefix: '/g/' + encodeURIComponent(slug) + '/admin', passwordId: 'admin-code', onAuthenticated: () => loadAll() });
let members = [];
let maps = [];

function fmt(n) { return Number(n).toLocaleString('en-US'); }
// Only for text and quoted attributes, never script/style or URL validation.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function imageUrl(value) {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f<>"'`\\]/.test(value)) return '';
  try {
    const url = new URL(value, window.location.href);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function domNode(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function avatarHtml(url, fallback, cls) {
  const safeUrl = imageUrl(url);
  const node = domNode(safeUrl ? 'img' : 'div', safeUrl ? cls : cls + ' avatar-fallback');
  if (safeUrl) { node.src = safeUrl; node.alt = ''; }
  else node.textContent = fallback || '?';
  return node.outerHTML;
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
const api = sessionClient.api;

// ===== MAIN ADMIN TABS =====
document.querySelectorAll('#admin-tabs .tab-btn').forEach(button => {
  button.onclick = () => {
    document.querySelectorAll('#admin-tabs .tab-btn').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('#panel > .tab-panel').forEach(panel => panel.classList.remove('active'));
    button.classList.add('active');
    document.getElementById(`admin-tab-${button.dataset.adminTab}`).classList.add('active');
  };
});

async function loadAll() {
  await Promise.all([loadDashboardState(), checkSwitchPreview(), loadMembers(), loadAdminLog()]);
  if (typeof window.refreshGymOverview === 'function') await window.refreshGymOverview();
}

// ===== STATE (dùng chung API public /state để lấy map/round hiện tại) =====
async function loadDashboardState() {
  const res = await fetch(`/g/${slug}/state`);
  const state = await res.json();
  document.getElementById('gym-name').textContent = state.gym.name + ' — Sub-Admin';
  maps = state.maps || [];

  document.getElementById('active-round-hint').textContent = state.active_round
    ? `Round đang active: Round ${state.active_round.round_number} (trần ${fmt(state.active_round.max_score)} pts)`
    : (state.has_completed_everything ? 'Đã hoàn thành toàn bộ nội dung hiện có — không thể nhập thêm.' : 'Chưa có Round active.');

  const mapSelect = document.getElementById('entry-map');
  // Map chưa clear luôn nằm trước, nhưng vẫn giữ các Map đã clear ở cuối danh sách
  // để Sub-Admin xem được trạng thái đầy đủ. Thứ tự gốc trong từng nhóm không đổi.
  const prioritizedMaps = prioritizeEntryMaps(maps);
  mapSelect.replaceChildren(...prioritizedMaps.map(m => {
    const remaining = state.active_round ? state.active_round.max_score - m.current_points : 0;
    return optionNode(m.id, m.name + (m.status === 'ended' ? ' (đã đạt trần)' : ` (còn thiếu ${fmt(remaining)} pts)`));
  }));
}

// ===== SEASON SWITCH BANNER =====
async function checkSwitchPreview() {
  const preview = await api('/season-switch/preview');
  document.getElementById('new-season-banner').classList.toggle('hidden', !preview.hasNewSeason);
  if (preview.hasNewSeason) {
    document.getElementById('new-season-name').textContent = preview.newSeasonName;
    window._switchPreview = preview;
  }
}
document.getElementById('open-switch-wizard').onclick = () => {
  const preview = window._switchPreview;
  document.getElementById('switch-wizard').classList.remove('hidden');
  renderWizardRows(preview.rosterToCopy || []);
};
document.getElementById('wizard-cancel').onclick = () => document.getElementById('switch-wizard').classList.add('hidden');

function optionNode(value, label) {
  const option = domNode('option', '', label);
  option.value = value;
  return option;
}

function renderWizardRows(roster) {
  const container = document.getElementById('wizard-rows');
  container.replaceChildren(...(roster.length ? roster : [{ name: '', avatar_url: '' }])
    .map(m => wizardRow(m.name, m.avatar_url)));
}
function wizardRow(name, avatar) {
  const row = domNode('div', 'wizard-row');
  const nameInput = domNode('input', 'wz-name');
  nameInput.type = 'text'; nameInput.placeholder = 'Tên thành viên'; nameInput.value = name || '';
  const avatarInput = domNode('input', 'wz-avatar');
  avatarInput.type = 'text'; avatarInput.placeholder = 'URL avatar (tuỳ chọn)'; avatarInput.value = avatar || '';
  const remove = domNode('button', 'btn btn-danger wz-remove', 'Xoá');
  remove.type = 'button'; remove.onclick = () => row.remove();
  // Preserve whitespace between inline controls from the original template.
  row.append('\n    ', nameInput, '\n    ', avatarInput, '\n    ', remove, '\n  ');
  return row;
}
document.getElementById('wizard-add-row').onclick = () => {
  document.getElementById('wizard-rows').append(wizardRow('', ''));
};

document.getElementById('wizard-submit').onclick = async () => {
  const msg = document.getElementById('wizard-msg');
  const rows = [...document.querySelectorAll('#wizard-rows .wizard-row')].map(r => ({
    name: r.querySelector('.wz-name').value,
    avatar_url: r.querySelector('.wz-avatar').value,
  })).filter(m => m.name.trim());

  if (!confirm('Chuyển sang Season mới sẽ đóng băng dữ liệu mùa hiện tại. Không thể hoàn tác. Tiếp tục?')) return;
  try {
    await api('/season-switch', { method: 'POST', body: JSON.stringify({ members: rows }) });
    msg.textContent = '✅ Đã chuyển Season mới!'; msg.className = 'msg success';
    document.getElementById('switch-wizard').classList.add('hidden');
    await loadAll();
  } catch (e) {
    msg.textContent = '⚠️ ' + e.message; msg.className = 'msg error';
  }
};

// ===== MEMBERS =====
async function loadMembers() {
  members = await api('/members');
  const list = document.getElementById('member-list');
  list.innerHTML = members.map(m => `
    <div class="list-row ${m.is_banned ? 'banned' : ''}" data-id="${escapeHtml(m.id)}">
      <div class="member-view-row">
        <span class="member-inline">${avatarHtml(m.avatar_url, m.name[0], 'avatar-sm')}
          <span>${escapeHtml(m.name)}</span>
          ${m.is_banned ? '<span class="badge-banned">Đã khoá</span>' : ''}
        </span>
        <span class="sub member-actions">
          <button class="btn btn-secondary mem-edit" style="padding:4px 10px;font-size:12px;">Sửa</button>
          <button class="btn ${m.is_banned ? 'btn-secondary' : 'btn-danger'} mem-ban" style="padding:4px 10px;font-size:12px;">${m.is_banned ? 'Mở khoá' : 'Khoá'}</button>
        </span>
      </div>
      <div class="member-edit-row hidden">
        <input type="text" class="mem-name" value="${escapeHtml(m.name)}" placeholder="Tên">
        <input type="text" class="mem-avatar" value="${escapeHtml(m.avatar_url || '')}" placeholder="URL avatar">
        <span class="member-actions">
          <button class="btn btn-primary mem-save" style="padding:4px 10px;font-size:12px;">Lưu</button>
          <button class="btn btn-secondary mem-cancel" style="padding:4px 10px;font-size:12px;">Huỷ</button>
        </span>
      </div>
    </div>`).join('') || '<p class="muted">Chưa có thành viên.</p>';

  const memberSelect = document.getElementById('entry-member');
  memberSelect.replaceChildren(...members.filter(m => !m.is_banned).map(m => optionNode(m.id, m.name)));

  list.querySelectorAll('.list-row').forEach(row => {
    const id = row.dataset.id;
    const member = members.find(m => m.id == id);
    const viewRow = row.querySelector('.member-view-row');
    const editRow = row.querySelector('.member-edit-row');
    row.querySelector('.mem-edit').onclick = () => {
      viewRow.classList.add('hidden');
      editRow.classList.remove('hidden');
      row.querySelector('.mem-avatar').focus();
    };
    row.querySelector('.mem-cancel').onclick = () => {
      row.querySelector('.mem-name').value = member.name;
      row.querySelector('.mem-avatar').value = member.avatar_url || '';
      editRow.classList.add('hidden');
      viewRow.classList.remove('hidden');
    };
    row.querySelector('.mem-save').onclick = async () => {
      const name = row.querySelector('.mem-name').value;
      const avatar_url = row.querySelector('.mem-avatar').value;
      // Update tại chỗ (PATCH /members/:id đã hỗ trợ avatar_url từ trước) — không tạo member mới,
      // không đổi id/gym_season_id, không ảnh hưởng Entry/lịch sử đã ghi của member này.
      try { await api(`/members/${id}`, { method: 'PATCH', body: JSON.stringify({ name, avatar_url }) }); await loadAll(); }
      catch (e) { alert('⚠️ ' + e.message); }
    };
    row.querySelector('.mem-ban').onclick = async () => {
      const newBanned = !member.is_banned;
      if (newBanned && !confirm(`Khoá "${member.name}"? Người này sẽ không thể ghi điểm mới nữa.`)) return;
      try { await api(`/members/${id}/ban`, { method: 'PATCH', body: JSON.stringify({ is_banned: newBanned }) }); await loadAll(); }
      catch (e) { alert('⚠️ ' + e.message); }
    };
  });
}

function newMemberRowHtml() {
  return `<div class="wizard-row">
    <input type="text" class="nm-name" placeholder="Tên thành viên">
    <input type="text" class="nm-avatar" placeholder="URL avatar (tuỳ chọn)">
  </div>`;
}
function renderNewMemberRows() {
  const c = document.getElementById('new-member-rows');
  c.innerHTML = '';
  for (let i = 0; i < 3; i++) c.insertAdjacentHTML('beforeend', newMemberRowHtml());
}
document.getElementById('add-member-row').onclick = () => {
  document.getElementById('new-member-rows').insertAdjacentHTML('beforeend', newMemberRowHtml());
};
document.getElementById('save-new-members').onclick = async () => {
  const msg = document.getElementById('member-msg');
  const rows = [...document.querySelectorAll('#new-member-rows .wizard-row')].map(r => ({
    name: r.querySelector('.nm-name').value, avatar_url: r.querySelector('.nm-avatar').value,
  })).filter(m => m.name.trim());
  if (!rows.length) { msg.textContent = '⚠️ Chưa nhập tên nào.'; msg.className = 'msg error'; return; }
  try {
    const result = await api('/members/bulk', { method: 'POST', body: JSON.stringify({ members: rows }) });
    msg.textContent = `✅ Đã thêm ${result.created} thành viên!`; msg.className = 'msg success';
    renderNewMemberRows();
    await loadAll();
  } catch (e) { msg.textContent = '⚠️ ' + e.message; msg.className = 'msg error'; }
};

// ===== ENTRY FORM =====
document.getElementById('entry-submit').onclick = async () => {
  const msg = document.getElementById('entry-msg');
  const map_id = Number(document.getElementById('entry-map').value);
  const member_id = Number(document.getElementById('entry-member').value);
  const tickets_used = Number(document.getElementById('entry-tickets').value);
  const points_scored = Math.trunc(Number(document.getElementById('entry-points').value));
  if (!map_id || !member_id || !points_scored) { msg.textContent = '⚠️ Điền đủ thông tin.'; msg.className = 'msg error'; return; }
  try {
    const result = await api('/entries', { method: 'POST', body: JSON.stringify({ member_id, map_id, tickets_used, points_scored }) });
    msg.textContent = '✅ Ghi nhận thành công!'; msg.className = 'msg success';
    document.getElementById('entry-points').value = '';
    await loadAll();
  } catch (e) { msg.textContent = '⚠️ ' + e.message; msg.className = 'msg error'; }
};

// ===== LOG MANAGEMENT =====
// Record -> Edit trực tiếp (không cần Delete rồi nhập lại): mỗi entry hiển thị ở "chế độ xem" (view mode),
// bấm "Sửa" mới chuyển sang form inline để chỉnh points/tickets; "Huỷ" trả về view mode KHÔNG lưu gì cả
// (dữ liệu hiển thị được reset lại từ giá trị gốc r.points_scored/r.tickets_used, không phải giá trị đang gõ dở).
// "Lưu" gọi PATCH /entries/:id (đã có sẵn engine.editEntry() xử lý transaction + recomputeRoundChain ở backend
// — KHÔNG tự tính toán/giả lập kết quả ở frontend).
let adminLogRowsCache = [];

function logCardHtml(r) {
  return `
    <div class="log-card" data-id="${escapeHtml(r.id)}">
      <div class="log-card-left">
        ${avatarHtml(r.map_image, r.map_name[0], 'avatar-md')}
        <div>
          <div class="log-member-name">${escapeHtml(r.map_name)} ${pokemonTypeIconHtml(r.map_type)}</div>
          <div class="log-time">${escapeHtml(r.member_name)} · ${timeAgo(r.created_at)}</div>
        </div>
      </div>
      <span class="round-chip small">Round ${escapeHtml(r.round_number)}</span>

      <div class="log-view-row">
        <span class="sub">🎫 ${escapeHtml(r.tickets_used)} vé · <strong style="color:var(--gold);">${escapeHtml(r.points_scored)}</strong> pts</span>
        <button class="btn btn-secondary ed-edit" style="padding:4px 10px;font-size:12px;">Sửa</button>
        <button class="btn btn-danger ed-del" style="padding:4px 10px;font-size:12px;">Xoá</button>
      </div>

      <div class="log-edit-row hidden">
        <input type="number" class="ed-points" aria-label="Điểm đạt được" value="${escapeHtml(r.points_scored)}" min="1" step="1" style="width:80px">pts ·
        <select class="ed-tickets" aria-label="Số vé đã dùng" style="width:56px">${[1,2,3].map(t=>`<option value="${t}" ${t===r.tickets_used?'selected':''}>${t}</option>`).join('')}</select>vé
        <button class="btn btn-primary ed-save" style="padding:4px 10px;font-size:12px;">Lưu</button>
        <button class="btn btn-secondary ed-cancel" style="padding:4px 10px;font-size:12px;">Huỷ</button>
        <p class="msg ed-msg"></p>
      </div>
    </div>`;
}

async function loadAdminLog() {
  adminLogRowsCache = await api('/entries');
  populateAdminLogFilters();
  renderAdminLog();
}

function setLogFilterOptions(selectId, placeholder, options) {
  const select = document.getElementById(selectId);
  const previousValue = select.value;
  select.replaceChildren(optionNode('', placeholder), ...options.map(option => optionNode(option.value, option.label)));
  if ([...select.options].some(option => option.value === previousValue)) select.value = previousValue;
}

function populateAdminLogFilters() {
  const membersById = new Map();
  const mapsById = new Map();
  const roundNumbers = new Set();

  adminLogRowsCache.forEach(row => {
    membersById.set(String(row.member_id), row.member_name);
    mapsById.set(String(row.season_template_map_id), row.map_name);
    roundNumbers.add(Number(row.round_number));
  });

  setLogFilterOptions('log-filter-member', 'Tất cả thành viên',
    [...membersById].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'vi')));
  setLogFilterOptions('log-filter-round', 'Tất cả Round',
    [...roundNumbers].sort((a, b) => a - b).map(round => ({ value: String(round), label: `Round ${round}` })));
  setLogFilterOptions('log-filter-map', 'Tất cả Map',
    [...mapsById].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'vi')));
}

function renderAdminLog() {
  const list = document.getElementById('admin-log-list');
  const filteredRows = filterAdminLogRows(adminLogRowsCache, {
    memberId: document.getElementById('log-filter-member').value,
    roundNumber: document.getElementById('log-filter-round').value,
    mapId: document.getElementById('log-filter-map').value,
  });
  const visibleRows = filteredRows.slice(0, 50);
  const summary = document.getElementById('log-filter-summary');

  if (!adminLogRowsCache.length) {
    summary.textContent = '';
    list.innerHTML = '<p class="muted">Chưa có lượt chơi nào.</p>';
    return;
  }

  summary.textContent = filteredRows.length > 50
    ? `Hiển thị 50 lượt đầu tiên trong ${fmt(filteredRows.length)} kết quả · Tổng ${fmt(adminLogRowsCache.length)} lượt`
    : `Hiển thị ${fmt(filteredRows.length)}/${fmt(adminLogRowsCache.length)} lượt`;
  list.innerHTML = visibleRows.map(logCardHtml).join('')
    || '<p class="muted">Không có lượt chơi phù hợp với bộ lọc.</p>';

  list.querySelectorAll('.log-card').forEach(row => {
    const id = row.dataset.id;
    const viewRow = row.querySelector('.log-view-row');
    const editRow = row.querySelector('.log-edit-row');
    const original = adminLogRowsCache.find(r => String(r.id) === String(id));

    row.querySelector('.ed-edit').onclick = () => {
      viewRow.classList.add('hidden');
      editRow.classList.remove('hidden');
    };
    row.querySelector('.ed-cancel').onclick = () => {
      // Huỷ: reset input về đúng giá trị gốc (phòng khi user đã gõ dở) rồi quay lại view mode — KHÔNG gọi API, không đổi dữ liệu.
      row.querySelector('.ed-points').value = original.points_scored;
      row.querySelector('.ed-tickets').value = original.tickets_used;
      row.querySelector('.ed-msg').textContent = '';
      editRow.classList.add('hidden');
      viewRow.classList.remove('hidden');
    };
    row.querySelector('.ed-save').onclick = async () => {
      const msg = row.querySelector('.ed-msg');
      const points_scored = Number(row.querySelector('.ed-points').value);
      const tickets_used = Number(row.querySelector('.ed-tickets').value);
      msg.textContent = 'Đang lưu...'; msg.className = 'msg';
      try {
        // Toàn bộ validate (max_score, ticket range/remaining, transaction, recomputeRoundChain) nằm ở backend (engine.editEntry) —
        // frontend chỉ gửi request và hiển thị kết quả/lỗi trả về, không tự phán đoán hợp lệ hay không.
        await api(`/entries/${id}`, { method: 'PATCH', body: JSON.stringify({ points_scored, tickets_used }) });
        await loadAll(); // refresh toàn bộ: log list, map progress/round status, combined score, tickets remaining
      } catch (e) {
        msg.textContent = '⚠️ ' + e.message; msg.className = 'msg error';
      }
    };
    row.querySelector('.ed-del').onclick = async () => {
      if (!confirm('Xoá lượt chơi này?')) return;
      try { await api(`/entries/${id}`, { method: 'DELETE' }); await loadAll(); }
      catch (e) { alert('⚠️ ' + e.message); }
    };
  });
}

['log-filter-member', 'log-filter-round', 'log-filter-map'].forEach(id => {
  document.getElementById(id).onchange = renderAdminLog;
});
document.getElementById('log-filter-reset').onclick = () => {
  document.getElementById('log-filter-member').value = '';
  document.getElementById('log-filter-round').value = '';
  document.getElementById('log-filter-map').value = '';
  renderAdminLog();
};

renderNewMemberRows();
sessionClient.restore();
})();


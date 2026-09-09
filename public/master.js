const sessionClient = createSessionClient({ prefix: '/master', passwordId: 'master-code', tabsId: 'master-tabs', onAuthenticated: () => loadDashboard() });
const api = sessionClient.api;
function fmt(n) { return Number(n).toLocaleString('en-US'); }

// Only for text and quoted attributes, never script/style or URL validation.
function masterEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function masterHttpUrl(value) {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f<>"'`\\]/.test(value)) return '';
  try {
    const url = new URL(value, window.location.href);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function masterNode(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
// API URLs never allow data:. Only local FileReader PNG/JPEG previews use this path.
function masterRasterPreviewUrl(value) {
  return typeof value === 'string' && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
}
function renderMapPreview(preview, safeUrl, alt) {
  preview.replaceChildren(masterNode('span', '', 'Ảnh'));
  if (!safeUrl) return;
  const img = masterNode('img');
  img.alt = alt;
  img.onerror = () => img.remove();
  img.src = safeUrl;
  preview.append(img);
}
function setGymLink(id, url) {
  const link = document.getElementById(id);
  const safeUrl = masterHttpUrl(url);
  link.removeAttribute('href');
  if (safeUrl) link.href = safeUrl;
  link.textContent = url;
}

// ===== TABS ===== (giống hệt pattern tab-switching ở dashboard.js)
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'dashboard') loadDashboard();
    if (btn.dataset.tab === 'seasons') loadSeasonList();
    if (btn.dataset.tab === 'gyms') loadGymList();
    if (btn.dataset.tab === 'requests') loadRequestList();
  };
});

// ===== DASHBOARD =====
async function loadDashboard() {
  const box = document.getElementById('dashboard-summary');
  box.innerHTML = '<p class="muted">Đang tải...</p>';
  try {
    const [seasons, gyms, requests] = await Promise.all([
      api('/season-templates'),
      api('/gyms'),
      api('/gym-requests?status=pending'),
    ]);
    const active = seasons.find(s => s.is_active);
    box.replaceChildren(...[
      ['Season Template đang active', active ? active.name : 'Chưa có'],
      ['Tổng số Season Templates', seasons.length],
      ['Tổng số Gym (đang hoạt động)', gyms.length],
      ['Gym Requests đang chờ duyệt', requests.length],
    ].map(([label, value]) => {
      const row = masterNode('div', 'list-row');
      row.append(masterNode('span', '', label), masterNode('span', 'sub', value));
      return row;
    }));
  } catch (e) {
    box.replaceChildren(masterNode('p', 'msg error', '⚠️ ' + e.message));
  }
}

// ===== SEASON TEMPLATES =====
let seasonListCache = [];
let editingSeasonId = null;

function utcIsoToLocalInputValue(utcIso) {
  // battle_start_at lưu UTC trong DB, hiển thị theo giờ Việt Nam (GMT+7) để Master Admin nhập/xem quen mắt
  const d = new Date(new Date(utcIso).getTime() + 7 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function localInputValueToUtcIso(inputValue) {
  // input datetime-local không có timezone — theo PRD, giá trị nhập là giờ Việt Nam (GMT+7)
  return new Date(`${inputValue}:00+07:00`).toISOString();
}

async function loadSeasonList() {
  const box = document.getElementById('season-list');
  box.innerHTML = '<p class="muted">Đang tải...</p>';
  try {
    seasonListCache = await api('/season-templates');
    box.innerHTML = seasonListCache.map(s => `
      <div class="list-row" data-id="${masterEscape(s.id)}">
        <span>${masterEscape(s.name)} ${s.is_active ? '<span class="round-chip small">Đang active</span>' : ''}</span>
        <span class="sub">${masterEscape(s.gym_count)} Gym đang dùng
          <button class="btn btn-secondary st-edit" style="padding:4px 10px;font-size:12px;margin-left:8px;">Sửa</button>
          ${s.is_active ? '' : '<button class="btn btn-primary st-activate" style="padding:4px 10px;font-size:12px;margin-left:6px;">Kích hoạt</button>'}
        </span>
      </div>`).join('') || '<p class="muted">Chưa có Season Template nào.</p>';

    box.querySelectorAll('.list-row').forEach(row => {
      const id = Number(row.dataset.id);
      const editBtn = row.querySelector('.st-edit');
      if (editBtn) editBtn.onclick = () => startEditSeason(id);
      const activateBtn = row.querySelector('.st-activate');
      if (activateBtn) activateBtn.onclick = () => activateSeason(id);
    });
  } catch (e) {
    box.replaceChildren(masterNode('p', 'msg error', '⚠️ ' + e.message));
  }
}

async function activateSeason(id) {
  if (!confirm('Kích hoạt Season Template này? Mọi Gym mới tạo/chuyển mùa sau đây sẽ dùng Season này.')) return;
  try {
    await api(`/season-templates/${id}/activate`, { method: 'PATCH' });
    await loadSeasonList();
  } catch (e) { alert('⚠️ ' + e.message); }
}

function mapRowHtml(m = {}) {
  return `<div class="wizard-row map-config-row">
    <input type="hidden" class="map-id" value="${masterEscape(m.id || '')}">
    <input type="text" class="map-name" placeholder="Tên Map" value="${masterEscape(m.name || '')}">
    <select class="map-type">${pokemonTypeOptionsHtml(m.type_weakness)}</select>
    <div class="map-image-upload">
      <input type="hidden" class="map-image" value="${masterEscape(m.image_url || '')}">
      <div class="map-image-preview"><span>Ảnh</span></div>
      <div class="map-image-controls">
        <input type="file" class="map-image-file" accept=".png,.jpg,.jpeg,image/png,image/jpeg">
        <button class="btn btn-secondary map-image-clear" type="button">Bỏ ảnh</button>
        <small class="map-image-status">PNG/JPEG · tối đa 5 MB</small>
      </div>
    </div>
    <input type="text" class="map-note" placeholder="Ghi chú tự do" value="${masterEscape(m.note || '')}">
    <button class="btn btn-danger map-remove" type="button">Xoá</button>
  </div>`;
}
// round_number KHÔNG cho user nhập tay nữa — tự sinh từ vị trí row (1, 2, 3...), theo yêu cầu task.
// Label hiển thị "Round N" được cập nhật lại mỗi khi add/xoá row (xem renumberRounds()).
// max_score vẫn nhập tay độc lập từng row, không bắt buộc tăng dần (đúng PRD).
function roundRowHtml(r = {}) {
  return `<div class="wizard-row" style="grid-template-columns:1fr 1fr auto;">
    <span class="round-number-label" style="align-self:center;font-family:var(--font-display);color:var(--gold);">Round ${masterEscape(r.round_number || '?')}</span>
    <input type="number" class="round-max" placeholder="max_score" min="1" step="1" value="${masterEscape(r.max_score || '')}">
    <button class="btn btn-danger round-remove" type="button">Xoá</button>
  </div>`;
}
function renumberRounds() {
  document.querySelectorAll('#st-rounds .wizard-row .round-number-label').forEach((label, i) => {
    label.textContent = `Round ${i + 1}`;
  });
}
function updateRepeatScorePreview() {
  const roundMaxInputs = [...document.querySelectorAll('#st-rounds .round-max')];
  const lastValue = roundMaxInputs.length ? Number(roundMaxInputs[roundMaxInputs.length - 1].value) : 0;
  document.getElementById('st-repeat-preview').textContent = lastValue > 0 ? `${fmt(lastValue)} pts` : '—';
}
function bindMapImageInputs() {
  document.querySelectorAll('#st-maps .wizard-row').forEach(row => {
    const fileInput = row.querySelector('.map-image-file');
    const hiddenInput = row.querySelector('.map-image');
    const preview = row.querySelector('.map-image-preview');
    const status = row.querySelector('.map-image-status');

    if (!preview.querySelector('img')) {
      renderMapPreview(preview, masterHttpUrl(hiddenInput.value), 'Ảnh ' + (row.querySelector('.map-name').value || 'Map'));
    }
    fileInput.onchange = () => {
      const file = fileInput.files[0];
      if (!file) return;
      if (!['image/png', 'image/jpeg'].includes(file.type)) {
        fileInput.value = '';
        status.textContent = 'Chỉ chấp nhận PNG hoặc JPEG';
        status.className = 'map-image-status error';
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        fileInput.value = '';
        status.textContent = 'Ảnh vượt quá 5 MB';
        status.className = 'map-image-status error';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        // Ignore a read completed after clear, replacement, or removal of this row.
        if (!row.isConnected || fileInput.files[0] !== file) return;
        renderMapPreview(preview, masterRasterPreviewUrl(reader.result), 'Xem trước ảnh Map');
      };
      reader.readAsDataURL(file);
      status.textContent = file.name;
      status.className = 'map-image-status success';
    };

    row.querySelector('.map-image-clear').onclick = () => {
      hiddenInput.value = '';
      fileInput.value = '';
      renderMapPreview(preview, '', '');
      status.textContent = 'Đã bỏ ảnh';
      status.className = 'map-image-status';
    };
  });
}
function bindRemoveButtons() {
  document.querySelectorAll('.map-remove').forEach(btn => { btn.onclick = () => btn.closest('.wizard-row').remove(); });
  document.querySelectorAll('.round-remove').forEach(btn => {
    btn.onclick = () => { btn.closest('.wizard-row').remove(); renumberRounds(); updateRepeatScorePreview(); };
  });
  document.querySelectorAll('#st-rounds .round-max').forEach(input => { input.oninput = updateRepeatScorePreview; });
  bindMapImageInputs();
  updateRepeatScorePreview();
}
document.getElementById('st-add-map').onclick = () => {
  document.getElementById('st-maps').insertAdjacentHTML('beforeend', mapRowHtml());
  bindRemoveButtons();
};
document.getElementById('st-add-round').onclick = () => {
  const nextNumber = document.querySelectorAll('#st-rounds .wizard-row').length + 1;
  document.getElementById('st-rounds').insertAdjacentHTML('beforeend', roundRowHtml({ round_number: nextNumber }));
  bindRemoveButtons();
};

function resetSeasonForm() {
  editingSeasonId = null;
  document.getElementById('season-form-title').textContent = '➕ Tạo Season Template mới';
  document.getElementById('st-cancel-edit').classList.add('hidden');
  document.getElementById('st-name').value = '';
  document.getElementById('st-maps').innerHTML = '';
  document.getElementById('st-rounds').innerHTML = '';
  for (let i = 0; i < 8; i++) document.getElementById('st-maps').insertAdjacentHTML('beforeend', mapRowHtml());
  document.getElementById('st-rounds').insertAdjacentHTML('beforeend', roundRowHtml({ round_number: 1 }));
  renumberRounds();
  document.getElementById('st-battle-start').value = '';
  document.getElementById('st-day1').value = 12;
  document.getElementById('st-daily').value = 3;
  document.getElementById('st-regen').value = 6;
  bindRemoveButtons();
  document.getElementById('st-msg').textContent = '';
}

async function startEditSeason(id) {
  const msg = document.getElementById('st-msg');
  try {
    const { season, maps, rounds } = await api(`/season-templates/${id}`);
    editingSeasonId = id;
    document.getElementById('season-form-title').textContent = `✏️ Sửa Season Template: ${season.name}`;
    document.getElementById('st-cancel-edit').classList.remove('hidden');
    document.getElementById('st-name').value = season.name;
    document.getElementById('st-maps').innerHTML = maps.map(m => mapRowHtml(m)).join('');
    document.getElementById('st-rounds').innerHTML = rounds.map(r => roundRowHtml(r)).join('');
    renumberRounds(); // đảm bảo label hiển thị luôn khớp với round_number sẽ thực sự được submit (tính theo vị trí)
    document.getElementById('st-battle-start').value = utcIsoToLocalInputValue(season.battle_start_at);
    document.getElementById('st-day1').value = season.ticket_day1_amount;
    document.getElementById('st-daily').value = season.ticket_daily_amount;
    document.getElementById('st-regen').value = season.ticket_regen_days;
    bindRemoveButtons();
    msg.textContent = '';
    document.getElementById('tab-seasons').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { msg.textContent = '⚠️ ' + e.message; msg.className = 'msg error'; }
}
document.getElementById('st-cancel-edit').onclick = resetSeasonForm;

async function uploadMapImage(file) {
  const result = await api('/map-images', {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!masterHttpUrl(result.image_url)) throw new Error('URL ảnh trả về không hợp lệ.');
  return result.image_url;
}

document.getElementById('st-submit').onclick = async () => {
  const msg = document.getElementById('st-msg');
  const name = document.getElementById('st-name').value;
  const mapDrafts = [...document.querySelectorAll('#st-maps .wizard-row')].map(r => ({
    row: r,
    id: r.querySelector('.map-id').value ? Number(r.querySelector('.map-id').value) : undefined,
    name: r.querySelector('.map-name').value,
    type_weakness: r.querySelector('.map-type').value,
    image_url: r.querySelector('.map-image').value,
    note: r.querySelector('.map-note').value,
  })).filter(m => m.name && m.name.trim());
  // round_number = vị trí row (1-based), KHÔNG đọc từ input — tự sinh theo yêu cầu, không cho user nhập tay.
  // LƯU Ý: không được lọc bỏ row thiếu max_score ở giữa danh sách — vì round_number giờ đây phụ thuộc
  // hoàn toàn vào vị trí, việc "xoá ngầm" 1 row giữa chừng sẽ làm các Round sau tụt số sai ý người dùng.
  // Nếu row nào thiếu max_score, phải báo lỗi rõ ràng và để user tự xoá hẳn row đó (nút Xoá), không tự suy đoán.
  const roundRows = [...document.querySelectorAll('#st-rounds .wizard-row')];
  const roundsRaw = roundRows.map((r, i) => ({ round_number: i + 1, max_score: r.querySelector('.round-max').value }));
  const emptyRoundIndex = roundsRaw.findIndex(r => r.max_score === '' || r.max_score == null);
  if (emptyRoundIndex !== -1) {
    msg.textContent = `⚠️ Round ${emptyRoundIndex + 1} chưa nhập max_score. Điền giá trị hoặc bấm "Xoá" dòng đó.`;
    msg.className = 'msg error';
    return;
  }
  const rounds = roundsRaw.map(r => ({ round_number: r.round_number, max_score: Number(r.max_score) }));
  const battleStartLocal = document.getElementById('st-battle-start').value;

  if (!name.trim()) { msg.textContent = '⚠️ Cần nhập Tên Season.'; msg.className = 'msg error'; return; }
  if (!mapDrafts.length) { msg.textContent = '⚠️ Cần ít nhất 1 Map.'; msg.className = 'msg error'; return; }
  if (!rounds.length) { msg.textContent = '⚠️ Cần ít nhất 1 Round.'; msg.className = 'msg error'; return; }
  if (!battleStartLocal) { msg.textContent = '⚠️ Cần nhập thời điểm bắt đầu phát vé.'; msg.className = 'msg error'; return; }

  // Cảnh báo trước khi sửa Season đang có Gym dùng (PRD §7) — dùng gym_count đã có sẵn từ list, không cần endpoint riêng
  if (editingSeasonId != null) {
    const current = seasonListCache.find(s => s.id === editingSeasonId);
    if (current && current.gym_count > 0) {
      const proceed = confirm(
        `Season này đang được ${current.gym_count} Gym sử dụng.\n\n` +
        `• Sửa max_score có thể làm Round đã "completed" của các Gym đó tự mở lại (reopen).\n` +
        `• ⚠️ Nếu bạn XOÁ hoặc thêm Round ở giữa danh sách (không phải cuối), các Round phía sau sẽ bị đánh số lại theo vị trí mới — ` +
        `điều này làm thay đổi Ý NGHĨA của "Round 2", "Round 3"... đối với dữ liệu lượt chơi ĐÃ GHI NHẬN của các Gym đang dùng Season này. ` +
        `Chỉ nên thêm Round ở CUỐI danh sách nếu Season đã có Gym đang chơi.\n\n` +
        `Tiếp tục lưu?`
      );
      if (!proceed) return;
    }
  }

  msg.textContent = 'Đang tải ảnh và lưu...'; msg.className = 'msg';
  try {
    const maps = await Promise.all(mapDrafts.map(async draft => {
      const file = draft.row.querySelector('.map-image-file').files[0];
      const imageUrl = file ? await uploadMapImage(file) : draft.image_url;
      if (file) draft.row.querySelector('.map-image').value = imageUrl;
      return {
        id: draft.id,
        name: draft.name,
        type_weakness: draft.type_weakness,
        image_url: imageUrl,
        note: draft.note,
      };
    }));
    const payload = {
      name,
      maps,
      rounds,
      // Backend cũng tự tính lại để không thể bypass bằng cách gọi API trực tiếp.
      repeat_max_score: rounds[rounds.length - 1].max_score,
      ticket_config: {
        battle_start_at: localInputValueToUtcIso(battleStartLocal),
        day1_amount: Number(document.getElementById('st-day1').value),
        daily_amount: Number(document.getElementById('st-daily').value),
        regen_days: Number(document.getElementById('st-regen').value),
      },
    };

    if (editingSeasonId != null) {
      const result = await api(`/season-templates/${editingSeasonId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      msg.textContent = `✅ Đã lưu! (${result.affected_gym_seasons} gym_season được recompute lại)`; msg.className = 'msg success';
    } else {
      await api('/season-templates', { method: 'POST', body: JSON.stringify(payload) });
      msg.textContent = '✅ Đã tạo Season Template mới!'; msg.className = 'msg success';
    }
    resetSeasonForm();
    await loadSeasonList();
  } catch (e) { msg.textContent = '⚠️ ' + e.message; msg.className = 'msg error'; }
};

// ===== GYMS =====
let gymSlugCheckTimer = null;
document.getElementById('gym-slug').addEventListener('input', () => {
  clearTimeout(gymSlugCheckTimer);
  const hint = document.getElementById('gym-slug-hint');
  const raw = document.getElementById('gym-slug').value.trim();
  if (!raw) { hint.textContent = ''; return; }
  gymSlugCheckTimer = setTimeout(async () => {
    try {
      const { slug, available } = await api(`/gyms/check-slug?slug=${encodeURIComponent(raw)}`);
      hint.textContent = available ? `✅ Slug "${slug}" khả dụng` : `⚠️ Slug "${slug}" đã tồn tại`;
      hint.style.color = available ? 'var(--mint)' : 'var(--coral)';
    } catch (e) { /* bỏ qua lỗi check-slug tạm thời */ }
  }, 350);
});

async function loadGymList() {
  const box = document.getElementById('gym-list');
  const includeDeleted = document.getElementById('gyms-include-deleted').checked;
  box.innerHTML = '<p class="muted">Đang tải...</p>';
  try {
    const gyms = await api(`/gyms?include_deleted=${includeDeleted ? '1' : '0'}`);
    box.innerHTML = gyms.map(g => `
      <div class="list-row ${g.deleted_at ? 'banned' : ''}" data-id="${masterEscape(g.id)}">
        <span>${masterEscape(g.name)} <span class="sub">/${masterEscape(g.slug)}</span> ${g.deleted_at ? '<span class="badge-banned">🗑️ Đã xoá</span>' : ''}</span>
        <span class="sub">
          <button class="btn btn-secondary gym-rename" style="padding:4px 10px;font-size:12px;">Đổi slug</button>
          ${g.deleted_at
            ? '<button class="btn btn-primary gym-restore" style="padding:4px 10px;font-size:12px;margin-left:6px;">Khôi phục</button>'
            : '<button class="btn btn-danger gym-delete" style="padding:4px 10px;font-size:12px;margin-left:6px;">Xoá</button>'}
        </span>
      </div>`).join('') || '<p class="muted">Chưa có Gym nào.</p>';

    box.querySelectorAll('.list-row').forEach(row => {
      const id = Number(row.dataset.id);
      const renameBtn = row.querySelector('.gym-rename');
      if (renameBtn) renameBtn.onclick = () => renameGymSlug(id);
      const deleteBtn = row.querySelector('.gym-delete');
      if (deleteBtn) deleteBtn.onclick = () => deleteGym(id);
      const restoreBtn = row.querySelector('.gym-restore');
      if (restoreBtn) restoreBtn.onclick = () => restoreGym(id);
    });
  } catch (e) {
    box.replaceChildren(masterNode('p', 'msg error', '⚠️ ' + e.message));
  }
}
document.getElementById('gyms-include-deleted').onchange = loadGymList;

async function renameGymSlug(id) {
  const newSlug = prompt('Nhập slug mới cho Gym này:');
  if (!newSlug || !newSlug.trim()) return;
  try {
    const result = await api(`/gyms/${id}/slug`, { method: 'PATCH', body: JSON.stringify({ slug: newSlug }) });
    alert(`✅ Đã đổi slug thành "${result.slug}"`);
    await loadGymList();
  } catch (e) { alert('⚠️ ' + e.message); }
}
async function deleteGym(id) {
  if (!confirm('Xoá (soft-delete) Gym này? Dữ liệu lịch sử vẫn được giữ, có thể khôi phục sau.')) return;
  try {
    await api(`/gyms/${id}/delete`, { method: 'PATCH' });
    await loadGymList();
  } catch (e) { alert('⚠️ ' + e.message); }
}
async function restoreGym(id) {
  try {
    await api(`/gyms/${id}/restore`, { method: 'PATCH' });
    await loadGymList();
  } catch (e) { alert('⚠️ ' + e.message); }
}

document.getElementById('gym-submit').onclick = async () => {
  const msg = document.getElementById('gym-msg');
  const name = document.getElementById('gym-name').value;
  const slug = document.getElementById('gym-slug').value;
  const admin_code = document.getElementById('gym-admin-code').value;
  if (!name.trim()) { msg.textContent = '⚠️ Cần nhập Tên Gym.'; msg.className = 'msg error'; return; }
  document.getElementById('gym-admin-code').value = '';
  msg.textContent = 'Đang tạo...'; msg.className = 'msg';
  try {
    const result = await api('/gyms', { method: 'POST', body: JSON.stringify({ name, slug, admin_code }) });
    msg.textContent = '✅ Đã tạo Gym!'; msg.className = 'msg success';
    document.getElementById('gym-name').value = '';
    document.getElementById('gym-slug').value = '';
    document.getElementById('gym-admin-code').value = '';
    document.getElementById('gym-slug-hint').textContent = '';

    const box = document.getElementById('gym-created-box');
    box.classList.remove('hidden');
    setGymLink('gym-created-dashboard', result.gym.dashboard_url);
    setGymLink('gym-created-admin', result.gym.admin_url);
    document.getElementById('gym-created-code').textContent = result.gym.admin_code;

    await loadGymList();
  } catch (e) { msg.textContent = '⚠️ ' + e.message; msg.className = 'msg error'; }
};

// ===== GYM REQUESTS (chỉ xem — duyệt/từ chối là Phase 7) =====
async function loadRequestList() {
  const box = document.getElementById('request-list');
  box.innerHTML = '<p class="muted">Đang tải...</p>';
  try {
    const rows = await api('/gym-requests?status=pending');
    box.innerHTML = rows.map(r => `
      <div class="list-row">
        <span>${masterEscape(r.gym_name)} ${r.desired_slug ? `<span class="sub">/${masterEscape(r.desired_slug)}</span>` : ''}</span>
        <span class="sub">${masterEscape(r.contact_info)}</span>
      </div>`).join('') || '<p class="muted">Không có request nào đang chờ.</p>';
  } catch (e) {
    box.replaceChildren(masterNode('p', 'msg error', '⚠️ ' + e.message));
  }
}

resetSeasonForm();

sessionClient.restore();


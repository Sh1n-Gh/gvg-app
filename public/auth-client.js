(() => {
  // CSRF is kept only in this closure. The browser manages the HttpOnly SID cookie.
  window.createSessionClient = function ({ prefix, passwordId, onAuthenticated, tabsId }) {
    let csrf = null;
    let epoch = 0;
    let authenticated = false;
    let busy = false;
    const panel = document.getElementById('panel');
    const lockBox = document.getElementById('lock-box');
    const message = document.getElementById('lock-msg');
    const password = document.getElementById(passwordId);
    const loginButton = document.getElementById('unlock-btn');
    const tabs = tabsId && document.getElementById(tabsId);
    const controls = document.createElement('div');
    controls.id = 'session-controls';
    controls.className = 'card form-card hidden';
    const status = document.createElement('p');
    status.id = 'session-msg'; status.className = 'msg'; status.setAttribute('role', 'status');
    const logoutButton = document.createElement('button');
    logoutButton.id = 'logout-btn'; logoutButton.className = 'btn btn-secondary'; logoutButton.textContent = 'Đăng xuất';
    const changeButton = document.createElement('button');
    changeButton.id = 'change-password-btn'; changeButton.className = 'btn btn-secondary'; changeButton.textContent = 'Đổi mật khẩu';
    const form = document.createElement('form');
    form.id = 'change-password-form'; form.className = 'hidden';
    function field(id, labelText, autocomplete) {
      const label = document.createElement('label'); label.textContent = labelText;
      const input = document.createElement('input'); input.type = 'password'; input.id = id;
      input.autocomplete = autocomplete; input.required = true;
      label.append(input); form.append(label); return input;
    }
    const current = field('current-password', 'Mật khẩu hiện tại', 'current-password');
    const next = field('new-password', 'Mật khẩu mới (ít nhất 12 ký tự)', 'new-password');
    const save = document.createElement('button'); save.type = 'submit'; save.className = 'btn btn-primary'; save.textContent = 'Lưu mật khẩu';
    form.append(save); controls.append(status, logoutButton, changeButton, form);
    panel.before(controls);
    message.setAttribute('role', 'status');

    function lock(text = '') {
      epoch++; csrf = null; authenticated = false;
      password.value = ''; current.value = ''; next.value = '';
      panel.classList.add('hidden'); controls.classList.add('hidden');
      if (tabs) tabs.classList.add('hidden');
      lockBox.classList.remove('hidden');
      message.textContent = text; message.className = text ? 'msg error' : 'msg';
      // Preserve unsaved business forms. Hide one-time credentials on logout/expiry.
      const createdCode = document.getElementById('gym-created-code');
      if (createdCode) createdCode.textContent = '';
      const createPassword = document.getElementById('gym-admin-code');
      if (createPassword) createPassword.value = '';
    }
    function accept(data) {
      csrf = data.csrf_token; authenticated = true;
      password.value = '';
      document.querySelectorAll('.msg').forEach(item => {
        if (item.textContent.includes('Phiên đã hết hạn, vui lòng đăng nhập lại.')) item.textContent = '';
      });
      lockBox.classList.add('hidden'); panel.classList.remove('hidden'); controls.classList.remove('hidden');
      if (tabs) tabs.classList.remove('hidden');
      status.textContent = data.must_rotate ? 'Bạn đang dùng mật khẩu tạm hoặc mã cũ. Vui lòng đổi mật khẩu; vẫn có thể tiếp tục quản lý.' : 'Đã đăng nhập.';
    }
    function friendly(statusCode, data, authPath) {
      if (statusCode === 401) return authPath === '/auth/login' ? 'Mật khẩu không đúng. Vui lòng thử lại.' : 'Phiên đã hết hạn, vui lòng đăng nhập lại.';
      if (statusCode === 403) return 'Bạn không có quyền thực hiện yêu cầu này hoặc phiên xác thực đã thay đổi. Hãy tải lại trang.';
      if (statusCode === 429) return 'Bạn đã thử quá nhiều lần. Vui lòng chờ rồi thử lại.';
      if (statusCode === 404 && authPath.startsWith('/auth/')) return 'Không tìm thấy Gym hoặc Gym không còn hoạt động.';
      return authPath.startsWith('/auth/') ? 'Không thể xác thực. Hãy kiểm tra thông tin và thử lại.' : (data.error || 'Có lỗi xảy ra');
    }
    async function api(path, opts = {}) {
      const requestEpoch = epoch;
      const headers = new Headers(opts.headers || {});
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      if (!['GET', 'HEAD'].includes((opts.method || 'GET').toUpperCase()) && csrf) headers.set('X-CSRF-Token', csrf);
      let response;
      try { response = await fetch(prefix + path, { ...opts, headers, credentials: 'same-origin', cache: 'no-store' }); }
      catch { throw new Error('Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.'); }
      const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
      if (requestEpoch !== epoch) {
        const error = new Error('Phiên đã thay đổi. Vui lòng thử lại thao tác.'); error.stale = true; throw error;
      }
      if (!response.ok) {
        const text = friendly(response.status, data, path);
        if (response.status === 401 && path !== '/auth/login') lock(authenticated ? text : '');
        const error = new Error(text); error.status = response.status; throw error;
      }
      return data;
    }
    async function loadAfterAuth() {
      try { await onAuthenticated(); }
      catch (error) { if (authenticated) status.textContent = error.message; }
    }
    async function login() {
      if (busy) return;
      busy = true; loginButton.disabled = true; epoch++;
      message.textContent = 'Đang đăng nhập...'; message.className = 'msg';
      const body = JSON.stringify({ password: password.value }); password.value = '';
      try { accept(await api('/auth/login', { method: 'POST', body })); await loadAfterAuth(); }
      catch (error) { message.textContent = error.message; message.className = 'msg error'; }
      finally { busy = false; loginButton.disabled = false; }
    }
    loginButton.onclick = login;
    password.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); login(); } });
    logoutButton.onclick = async () => {
      if (busy) return;
      busy = true; logoutButton.disabled = true;
      try { await api('/auth/logout', { method: 'POST' }); lock('Đã đăng xuất.'); }
      catch (error) { status.textContent = error.message; }
      finally { busy = false; logoutButton.disabled = false; }
    };
    changeButton.onclick = () => { form.classList.toggle('hidden'); current.value = ''; next.value = ''; };
    form.onsubmit = async event => {
      event.preventDefault(); if (busy) return;
      if (Array.from(next.value).length < 12 || new TextEncoder().encode(next.value).length > 256) {
        status.textContent = 'Mật khẩu mới cần ít nhất 12 ký tự và tối đa 256 byte UTF-8.'; return;
      }
      busy = true; save.disabled = true;
      const body = JSON.stringify({ current_password: current.value, new_password: next.value });
      current.value = ''; next.value = '';
      try { accept(await api('/auth/change-password', { method: 'POST', body })); epoch++; form.classList.add('hidden'); status.textContent = 'Đã đổi mật khẩu.'; }
      catch (error) { status.textContent = error.message; }
      finally { busy = false; save.disabled = false; }
    };
    async function restore() {
      try { accept(await api('/auth/session')); await loadAfterAuth(); }
      catch (error) { if (!error.stale && error.status !== 401 && !authenticated && !busy) message.textContent = error.message; }
    }
    // Do not poll: checking a session repeatedly would itself keep it alive.
    window.addEventListener('pageshow', event => { if (event.persisted) { lock(); restore(); } });
    return { api, restore };
  };
})();

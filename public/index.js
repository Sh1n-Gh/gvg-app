function go() {
  const slug = document.getElementById('slug-input').value.trim().toLowerCase();
  if (!slug) { document.getElementById('err-msg').textContent = 'Vui lòng nhập mã Gym'; return; }
  window.location.href = '/g/' + encodeURIComponent(slug);
}
document.getElementById('go-btn').onclick = go;
document.getElementById('slug-input').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });

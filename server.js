require('dotenv').config({ quiet: true });
const express = require('express');
const path = require('path');
const { createDb } = require('./db');
const masterRoutes = require('./routes/master');
const gymAdminRoutes = require('./routes/gym-admin');
const gymPublicRoutes = require('./routes/gym-public');

// Tách việc tạo `app` ra hàm riêng để test có thể import & khởi tạo với DB riêng (VD: DB tạm cho smoke test)
// mà không cần mở cổng HTTP thật. Hành vi chạy thật (`node server.js`) không đổi.
function createApp(db, { env = process.env, now = Date.now, mapImages, logger } = {}) {
  require('./auth/config').validateConfig(db, env);
  const app = express();
  app.locals.logger = logger || require('./security/observability').createLogger(env);
  app.locals.lifecycle = require('./security/lifecycle').createLifecycle();
  app.locals.mapImages = mapImages || require('./security/map-images').createStore();
  const limits = require('./security/request-limits');
  const errors = require('./security/errors');
  app.use(errors.responseContext);
  app.use(require('./security/observability').requestLogging(app.locals.logger));
  require('./security/deployment').configureDeployment(app, env);
  app.disable('x-powered-by');
  app.use(require('./security/headers').securityHeaders(env));

  app.get('/health', (req, res) => res.set('Cache-Control', 'no-store').json({ status: 'ok' }));
  app.get('/ready', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (app.locals.lifecycle.draining) return res.status(503).json({});
      db.prepare('SELECT version FROM schema_migrations LIMIT 1').get();
      return res.json({ status: 'ok' });
    } catch {
      app.locals.logger.log('error', 'readiness_failed', { request_id: req.requestId, error_kind: 'database' });
      return res.status(503).json({});
    }
  });
  app.use(app.locals.lifecycle.middleware);
  app.use(limits.requestLimits(now));
  app.param('slug', require('./security/validation').slugParam);
  const auth = require('./auth/backend').createAuth(db, env, { now });
  app.locals.auth = auth;

  app.use((req, res, next) => {
    const authBody = /\/auth(?:\/|$)|\/admin-password\/reset\/?$/i.test(req.path);
    const upload = /^\/master\/map-images\/?$/i.test(req.path) && req.method === 'POST';
    const form = req.is('multipart/form-data') || req.is('application/x-www-form-urlencoded');
    const max = form || authBody ? 8192 : upload ? 5 * 1024 * 1024 : 128 * 1024;
    const length = Number(req.get('content-length') || 0);
    if (length > max) return res.status(413).json({ error: 'Request vượt giới hạn dung lượng' });
    if ((length > 0 || req.get('transfer-encoding')) && !req.is('application/json') && !(upload && (req.is('image/png') || req.is('image/jpeg')))) {
      return res.status(400).json({ error: 'Chỉ nhận JSON hoặc ảnh PNG/JPEG raw tại endpoint upload' });
    }
    next();
  });
  app.use((req, res, next) => {
    if (/\/auth(?:\/|$)|\/admin-password\/reset\/?$/i.test(req.path)) {
      res.set('Cache-Control', 'no-store');
      return express.json({ limit: '8kb', inflate: false })(req, res, next);
    }
    return express.json({ limit: '128kb', inflate: false })(req, res, next);
  });
  // Reject even empty forms. No form parser or multipart allocation is installed.
  app.use((req, res, next) => {
    if (req.is('multipart/form-data') || req.is('application/x-www-form-urlencoded')) {
      const size = Number(req.get('content-length'));
      return res.status(size > 8192 ? 413 : 400).json({ error: 'Form không được hỗ trợ; dùng JSON hoặc ảnh PNG/JPEG raw' });
    }
    next();
  });
  app.use((req, res, next) => { req.db = db; next(); });

  // Static assets (style.css, dashboard.js, admin.js) + trang chủ (index.html tại "/")
  app.use('/uploads/map-images', require('./security/lifecycle').tracked(app.locals.mapImages.serve));
  app.use(express.static(path.join(__dirname, 'public')));

  // Lưu ý khác với pattern /g/:slug/admin bên dưới: routes/master.js áp `requireMasterAdmin`
  // bằng `router.use(...)` (chặn TOÀN BỘ path con, kể cả path gốc "/master"), trong khi
  // gym-admin.js chỉ áp auth theo từng route riêng lẻ. Vì vậy route HTML tĩnh cho đúng
  // path "/master" (exact match, không có path con) phải đăng ký TRƯỚC khi mount masterRoutes,
  // nếu không middleware auth sẽ chặn cả request xin trang HTML (trả 403 trước khi tới fallback).
  // Các path con như /master/verify, /master/gyms... vẫn đi qua masterRoutes bình thường vì
  // app.get('/master', ...) chỉ match chính xác "/master", không match path con.
  app.get('/master', (req, res) => res.sendFile(path.join(__dirname, 'public', 'master.html')));
  app.use('/master', auth.master);
  app.use('/master', masterRoutes);

  // API JSON trước, trang HTML tương ứng đặt sau làm fallback khi không match sub-path nào trong API
  app.use('/g/:slug/admin', auth.gym, gymAdminRoutes);
  app.get('/g/:slug/admin', (req, res) => res.redirect(302, `/g/${encodeURIComponent(req.params.slug)}#admin`));

  app.use('/g/:slug', gymPublicRoutes);
  app.get('/g/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

  app.use(errors.notFound);
  app.use(errors.errorHandler(env));
  return app;
}

if (require.main === module) {
  const logger = require('./security/observability').createLogger();
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db', 'gvg.db');
  let db;
  try {
    db = createDb(DB_PATH);
    const app = createApp(db, { logger });
    if (process.env.NODE_ENV === 'production') {
      const missing = db.prepare("SELECT count(*) n FROM gyms g LEFT JOIN auth_principals p ON p.gym_id=g.id AND p.role='gym' WHERE p.id IS NULL").get().n;
      const master = db.prepare("SELECT id FROM auth_principals WHERE role='master' AND disabled_at IS NULL").get();
      if (missing || !master) throw new Error('AUTH_CONFIG: run npm run auth:migrate offline before production startup');
    }
    const timeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS || 30000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new Error('Invalid shutdown timeout');
    const server = app.listen(require('./security/deployment').listenOptions(), () => logger.log('info', 'server_started'));
    require('./security/lifecycle').installShutdown(server, app, db, { timeoutMs });
    server.on('error', () => { logger.log('error', 'startup_failed'); process.exit(1); });
  } catch (err) {
    if (db) db.close();
    logger.log('error', 'startup_failed');
    process.exitCode = 1;
  }
}

module.exports = { createApp };

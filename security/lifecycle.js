function createLifecycle() {
  const state = { draining: false, active: 0, operations: 0 };
  const waiters = new Set();
  function notify() { if (!state.active && !state.operations) { for (const resolve of waiters) resolve(); waiters.clear(); } }
  state.track = async fn => { state.operations++; try { return await fn(); } finally { state.operations--; notify(); } };
  state.idle = () => !state.active && !state.operations ? Promise.resolve() : new Promise(resolve => waiters.add(resolve));
  state.middleware = (req, res, next) => {
    if (state.draining) return res.set('Connection', 'close').status(503).json({});
    state.active++;
    let done = false;
    const end = () => { if (!done) { done = true; state.active--; notify(); } };
    res.once('finish', end); res.once('close', end); next();
  };
  return state;
}
function tracked(handler) {
  return function(req, res, next) {
    return req.app.locals.lifecycle.track(() => handler(req, res, next)).catch(next);
  };
}
// Track the entire async handler, including DB work after an aborted HTTP response.
function trackedRouter(router) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const register = router[method];
    router[method] = function(path, ...handlers) {
      return register.call(this, path, ...handlers.flat(Infinity).map(fn => tracked(fn)));
    };
  }
  return router;
}
function installShutdown(server, app, db, { timeoutMs = 30000, signals = process, exit = code => process.exit(code) } = {}) {
  const state = app.locals.lifecycle, logger = app.locals.logger;
  let pending;
  const shutdown = () => {
    if (pending) return pending;
    state.draining = true;
    app.locals.auth.close();
    logger.log('info', 'shutdown_started', { active: state.active, operations: state.operations });
    pending = (async () => {
      const timer = setTimeout(() => {
        logger.log('error', 'shutdown_timeout', { active: state.active, operations: state.operations });
        // Do not close SQLite underneath pending operations. Supervisor restarts on failure.
        exit(1);
      }, timeoutMs);
      try {
        const closed = new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
        server.closeIdleConnections();
        await Promise.all([closed, state.idle()]);
        db.close();
        logger.log('info', 'shutdown_complete');
      } catch {
        logger.log('error', 'shutdown_failed'); exit(1);
      } finally {
        clearTimeout(timer);
        signals.removeListener('SIGTERM', shutdown); signals.removeListener('SIGINT', shutdown);
      }
    })();
    return pending;
  };
  signals.on('SIGTERM', shutdown); signals.on('SIGINT', shutdown);
  return shutdown;
}
module.exports = { createLifecycle, tracked, trackedRouter, installShutdown };

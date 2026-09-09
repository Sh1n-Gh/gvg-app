const { performance } = require('node:perf_hooks');
const events = new Set(['request_complete', 'request_error', 'readiness_failed', 'startup_failed', 'server_started', 'shutdown_started', 'shutdown_complete', 'shutdown_timeout', 'shutdown_failed', 'auth_cleanup_failed']);
const levels = { debug: 10, info: 20, warn: 30, error: 40 };
// Deny by default, including unknown fields, free text, Error stacks and nested objects.
// Never serialize caller objects or invoke their toJSON/getters.
function redact(fields = {}) {
  const out = {};
  const rules = {
    request_id: v => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v),
    method: v => ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(v),
    status: v => Number.isInteger(v) && v >= 100 && v <= 599,
    duration_ms: v => Number.isFinite(v) && v >= 0,
    active: v => Number.isInteger(v) && v >= 0,
    operations: v => Number.isInteger(v) && v >= 0,
    error_kind: v => ['database', 'application', 'request'].includes(v),
    probe: v => ['health', 'ready', 'none'].includes(v),
  };
  for (const [key, rule] of Object.entries(rules)) {
    const descriptor = Object.getOwnPropertyDescriptor(fields, key);
    if (descriptor && rule(descriptor.value)) out[key] = descriptor.value;
  }
  return out;
}
function createLogger(env = process.env, write = line => process.stdout.write(line)) {
  const environment = ['production', 'development', 'test'].includes(env.NODE_ENV) ? env.NODE_ENV : 'unknown';
  const threshold = levels[env.LOG_LEVEL] || (environment === 'development' ? levels.debug : levels.info);
  return { log(level, event, fields) {
    if (!events.has(event) || !levels[level] || levels[level] < threshold) return;
    try { write(JSON.stringify({ time: new Date().toISOString(), level, environment, event, ...redact(fields) }) + '\n'); }
    catch { /* Telemetry failure must not expose the original payload or break a request. */ }
  } };
}
function requestLogging(logger) {
  return (req, res, next) => {
    const start = performance.now();
    let logged = false;
    const done = () => {
      if (logged) return;
      logged = true;
      const status = res.writableFinished ? res.statusCode : 499;
      logger.log(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'request_complete', {
        request_id: req.requestId, method: req.method, status,
        duration_ms: Math.round((performance.now() - start) * 100) / 100,
        probe: req.path === '/health' ? 'health' : req.path === '/ready' ? 'ready' : 'none',
      });
    };
    res.once('finish', done); res.once('close', done); next();
  };
}
module.exports = { createLogger, redact, requestLogging };

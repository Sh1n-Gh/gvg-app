const { configureProxy } = require('./request-limits');

function configureDeployment(app, env = process.env) {
  const production = env.NODE_ENV === 'production';
  if (production && env.TRUST_PROXY !== '127.0.0.1') {
    throw new Error('SECURITY_CONFIG: production requires TRUST_PROXY=127.0.0.1 for the same-host proxy');
  }
  configureProxy(app, env.TRUST_PROXY);
  if (!production) return;
  let origin;
  try { origin = new URL(env.PUBLIC_ORIGIN); } catch { /* validated below */ }
  if (!origin || origin.protocol !== 'https:' || origin.origin !== env.PUBLIC_ORIGIN
      || origin.port || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(origin.hostname)) {
    throw new Error('SECURITY_CONFIG: PUBLIC_ORIGIN requires one exact HTTPS DNS origin on port 443');
  }
  const allowed = new Set([origin.hostname, `${origin.hostname}:443`]);
  // Check the raw Host as well: req.hostname alone trusts X-Forwarded-Host.
  app.use((req, res, next) => {
    const host = req.get('host');
    const forwarded = req.get('x-forwarded-host');
    if (!host || !allowed.has(host.toLowerCase())
        || (forwarded !== undefined && !allowed.has(forwarded.toLowerCase()))) {
      return res.status(400).json({ error: 'Host không hợp lệ', code: 'INVALID_REQUEST' });
    }
    next();
  });
}

function listenOptions(env = process.env) {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SECURITY_CONFIG: invalid PORT');
  // Production cannot be exposed by an accidental HOST=0.0.0.0.
  return { port, host: env.NODE_ENV === 'production' ? '127.0.0.1' : env.HOST || '127.0.0.1' };
}
module.exports = { configureDeployment, listenOptions };

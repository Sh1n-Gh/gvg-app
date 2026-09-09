const net = require('node:net');
function configureProxy(app, value = '') {
  if (!value || value === 'false') return app.set('trust proxy', false);
  const entries = value.split(',').map(s => s.trim());
  // Only explicit IP/CIDR ranges: never trust every sender or a hop count.
  for (const entry of entries) {
    const [ip, bits, extra] = entry.split('/');
    const family = net.isIP(ip);
    if (!family || extra !== undefined || (bits !== undefined && (!/^\d+$/.test(bits) || Number(bits) < 1 || Number(bits) > (family === 4 ? 32 : 128)))) throw new Error('AUTH_CONFIG: TRUST_PROXY must contain explicit proxy IP/CIDR addresses');
  }
  app.set('trust proxy', entries);
}
function clientIp(req) {
  // Express has already discarded forwarding headers from untrusted peers.
  const value = (req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  if (net.isIP(value) !== 6) return value;
  // Group IPv6 privacy addresses by /64 without depending on a transitive package.
  const hostname = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const halves = hostname.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return words.slice(0, 4).map(w => parseInt(w, 16).toString(16)).join(':') + '::/64';
}
function requestLimits(now = Date.now) {
  const buckets = new Map();
  let cleanupAt = 0;
  return (req, res, next) => {
    if (!/^\/(?:master|g)(?:\/|$)/i.test(req.path)) return next();
    const auth = /\/(?:auth\/(?:login|change-password)|verify)\/?$/i.test(req.path);
    const upload = /^\/master\/map-images\/?$/i.test(req.path);
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const group = auth ? 'auth' : upload ? 'upload' : mutation ? 'mutation' : 'read';
    const max = { auth: 20, upload: 10, mutation: 120, read: 240 }[group];
    const windowMs = auth ? 15 * 60e3 : 60e3;
    const t = now();
    if (t >= cleanupAt) {
      for (const [key, b] of buckets) if (b.until <= t) buckets.delete(key);
      cleanupAt = t + 60e3;
    }
    const key = `${group}:${clientIp(req)}`;
    let b = buckets.get(key);
    if (!b || b.until <= t) {
      // Fail closed at capacity instead of evicting active limits for attackers.
      if (!b && buckets.size >= 20000) return res.set('Retry-After', '60').status(429).json({ error: 'Thử lại sau' });
      b = { count: 0, until: t + windowMs }; buckets.set(key, b);
    }
    if (++b.count > max) return res.set('Retry-After', String(Math.max(1, Math.ceil((b.until - t) / 1000)))).status(429).json({ error: 'Thử lại sau' });
    next();
  };
}
module.exports = { configureProxy, clientIp, requestLimits };

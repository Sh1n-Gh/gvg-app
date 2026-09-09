const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Only bundled SVG documents need style elements. Hash their exact, XML-normalized
// text rather than allowing arbitrary inline style elements on application pages.
const icons = path.join(__dirname, '../public/assets/pokemon-types');
const svgHashes = [...new Set(fs.readdirSync(icons).filter(f => f.endsWith('.svg')).flatMap(f =>
  [...fs.readFileSync(path.join(icons, f), 'utf8').matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map(m => `'sha256-${createHash('sha256').update(m[1].replace(/\r\n?/g, '\n')).digest('base64')}'`)
))];

function imageOrigins(value = '') {
  return [...new Set(value.split(',').map(v => v.trim()).filter(Boolean).map(v => {
    let url;
    try { url = new URL(v); } catch { /* fail with a configuration-only message */ }
    if (!url || url.protocol !== 'https:' || url.origin !== v || /[*;\s]/.test(v)) {
      throw new Error('SECURITY_CONFIG: CSP_IMAGE_ORIGINS requires comma-separated exact HTTPS origins');
    }
    return v;
  }))];
}

function securityHeaders(env = process.env) {
  const policy = [
    "default-src 'none'", "base-uri 'none'", "object-src 'none'",
    "frame-ancestors 'none'", "frame-src 'none'", "form-action 'self'",
    "script-src 'self'", "script-src-attr 'none'",
    "style-src 'self' https://fonts.googleapis.com",
    "style-src-attr 'unsafe-inline'",
    "font-src https://fonts.gstatic.com",
    `img-src 'self' data: ${imageOrigins(env.CSP_IMAGE_ORIGINS).join(' ')}`.trim(),
    "connect-src 'self'", "worker-src 'none'", "manifest-src 'none'",
  ];
  const csp = policy.join('; ');
  return (req, res, next) => {
    const bundledSvg = /^\/assets\/pokemon-types\/[a-z]+\.svg$/.test(req.path);
    res.set({
      'Content-Security-Policy': csp + (bundledSvg ? `; style-src-elem ${svgHashes.join(' ')}` : ''),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), browsing-topics=()',
    });
    // req.secure respects only the explicitly configured trust proxy chain.
    // PUBLIC_ORIGIN alone does not prove that this request arrived over HTTPS.
    if (env.NODE_ENV === 'production' && req.secure) {
      res.set('Strict-Transport-Security', 'max-age=31536000');
    }
    next();
  };
}

module.exports = { securityHeaders, imageOrigins };

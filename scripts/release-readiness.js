// Local-only probe, with production Host allowlist header; never log bodies.
const http = require('node:http');
function probe(port, host) {
  return new Promise(resolve => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/ready', headers: { Host: host } }, response => {
      let body = '';
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 4096) request.destroy();
      });
      response.on('error', () => resolve(false));
      response.on('end', () => {
        try { resolve(response.statusCode === 200 && JSON.parse(body).status === 'ok'); }
        catch { resolve(false); }
      });
    });
    const timer = setTimeout(() => request.destroy(), 2000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', () => resolve(false));
  });
}
async function readiness({ port = 3000, host, attempts = 30, delayMs = 1000 }) {
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !Number.isInteger(attempts) || attempts < 1 || attempts > 60) return false;
  for (let i = 0; i < attempts; i++) {
    try {
      if (await probe(port, host)) return true;
    } catch { /* bounded retry */ }
    if (i + 1 < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}
module.exports = { readiness };

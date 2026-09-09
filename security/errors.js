const { randomUUID } = require('node:crypto');

// Only application-authored messages may cross the error boundary.
class PublicError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const codes = { 400: 'INVALID_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 429: 'RATE_LIMITED', 500: 'INTERNAL_ERROR' };
const messages = { 400: 'Yêu cầu không hợp lệ', 404: 'Không tìm thấy tài nguyên', 409: 'Dữ liệu bị xung đột', 413: 'Request vượt giới hạn dung lượng', 500: 'Có lỗi xảy ra. Vui lòng thử lại sau.' };
function isPage(req) {
  return ['GET', 'HEAD'].includes(req.method) && req.accepts(['html', 'json']) === 'html'
    && !!req.get('accept')?.includes('text/html')
    && !/^\/(?:master\/|g\/[^/]+\/|uploads\/)/i.test(req.originalUrl.split('?')[0]);
}
function responseContext(req, res, next) {
  // Generate locally: caller-controlled IDs cannot inject secrets or impersonate another request.
  req.requestId = randomUUID();
  res.set('X-Request-ID', req.requestId);
  const json = res.json.bind(res);
  res.json = body => {
    if (res.statusCode < 400) return json(body);
    res.set('Cache-Control', 'no-store');
    const status = res.statusCode;
    const payload = { error: status >= 500 ? messages[500] : body?.error || messages[status] || 'Không thể xử lý yêu cầu', code: codes[status] || 'REQUEST_FAILED', request_id: req.requestId };
    if (res.locals.errorDebug) payload.debug = res.locals.errorDebug;
    if ([404, 500].includes(status) && isPage(req)) {
      // Static text + server-generated UUID only; no URL, message or stack in HTML.
      return res.type('html').send(`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${status} | GvG</title><body><main><h1>${status === 404 ? 'Không tìm thấy trang' : 'Tạm thời không thể tải trang'}</h1><p>${messages[status]}</p><p><a href="/">Về trang chủ</a></p><p>Mã yêu cầu: ${req.requestId}</p></main></body></html>`);
    }
    return json(payload);
  };
  const sendStatus = res.sendStatus.bind(res);
  res.sendStatus = status => status >= 400 ? res.status(status).json({ error: messages[status] || codes[status] }) : sendStatus(status);
  next();
}
const notFound = (req, res) => res.status(404).json({ error: messages[404] });
function errorHandler(env = process.env) {
  return (err, req, res, next) => {
    req.app.locals.logger?.log('error', 'request_error', { request_id: req.requestId, error_kind: typeof err.code === 'string' && err.code.startsWith('SQLITE_') ? 'database' : 'application' });
    if (res.headersSent) { res.destroy(); return; }
    let status = 500;
    if (err instanceof PublicError) status = err.status;
    else if (err.type === 'entity.too.large') status = 413;
    else if (typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) status = 409;
    else if ([400, 404, 413, 415].includes(err.status)) status = err.status === 415 ? 400 : err.status;
    if (env.NODE_ENV === 'development') res.locals.errorDebug = { message: err.message, stack: err.stack };
    res.status(status).json({ error: err instanceof PublicError ? err.message : messages[status] });
  };
}
module.exports = { PublicError, responseContext, notFound, errorHandler };


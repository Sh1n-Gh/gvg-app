// Upstream session debugging includes raw SID/cookie values. Disable that
// namespace before loading the pinned library, even when DEBUG=* is configured.
const { createRequire } = require('node:module');
const sessionRequire = createRequire(require.resolve('express-session'));
const debug = sessionRequire('debug');
debug.enable(`${process.env.DEBUG || ''},-express-session`);
module.exports = require('express-session');

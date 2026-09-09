const fs = require('node:fs');
const path = require('node:path');

// Fail closed after a crash. Never steal a lock based on PID or elapsed time.
function acquire(databasePath, suffix = '.migration-lock') {
  const canonical = fs.realpathSync(databasePath);
  const lock = canonical + suffix;
  fs.mkdirSync(lock, { mode: 0o700 });
  return () => fs.rmdirSync(lock);
}
module.exports = { acquire };

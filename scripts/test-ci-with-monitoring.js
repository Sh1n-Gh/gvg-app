const { spawnSync } = require('node:child_process');
const path = require('node:path');
const options = { cwd: path.join(__dirname, '..'), stdio: 'inherit' };
const regression = spawnSync(process.execPath, ['scripts/test-ci.js'], options);
// Run even when the blocking regression fails, and preserve that gate's status.
spawnSync(process.execPath, ['scripts/visual-monitoring.js'], options);
process.exitCode = regression.status ?? 1;

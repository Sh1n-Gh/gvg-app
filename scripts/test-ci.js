const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
// Includes standalone legacy suites and node:test suites; fail on any failure.
let failed = false;
for (const file of fs.readdirSync('test').filter(f => f.endsWith('-test.js')).sort()) {
  console.log(`Regression suite: ${file}`);
  const result = spawnSync(process.execPath, [`test/${file}`], { stdio: 'inherit', env: { ...process.env, VISUAL_SUITE_MODE: 'blocking' } });
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;

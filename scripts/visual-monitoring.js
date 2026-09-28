const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const output = path.join(root, 'tmp/visual-monitoring');
fs.mkdirSync(output, { recursive: true });
const summary = [];
for (const file of ['admin-xss-test.js', 'dashboard-xss-test.js', 'master-xss-test.js']) {
  const env = { ...process.env, VISUAL_SUITE_MODE: 'monitoring' };
  // Monitoring always runs the whole visual suite with its normal harness.
  delete env.VISUAL_CAPTURE_CASE;
  delete env.VISUAL_FREEZE_DASHBOARD_POLLING;
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `test/${file}`], {
    cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  const log = (result.stdout || '') + (result.stderr || '') + (result.error ? `\n${result.error.stack}\n` : '');
  fs.writeFileSync(path.join(output, `${file}.log`), log);
  process.stdout.write(log);
  const count = key => Number(log.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] || 0);
  const entry = { file, status: result.status === 0 && count('skipped') === 0 && count('tests') > 0 ? 'PASS' : 'FAIL', exitCode: result.status, signal: result.signal, pass: count('pass'), fail: count('fail'), skipped: count('skipped'), cancelled: count('cancelled') };
  summary.push(entry);
  console.log(`Visual monitoring (non-blocking): ${JSON.stringify(entry)}`);
}
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
// Raw child failures are retained above; visual results never decide the CI gate.
process.exitCode = 0;

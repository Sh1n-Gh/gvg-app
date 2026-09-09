const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
function run(command, args, cwd = process.cwd()) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function main() {
  if (process.platform !== 'linux') throw new Error('Linux builder required');
  if (run('git', ['status', '--porcelain'])) throw new Error('Clean committed checkout required');
  const commit = run('git', ['rev-parse', 'HEAD']);
  const version = require('../package.json').version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid version');
  const id = `${version}-${commit}`;
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'gvg-build-'));
  try {
    const files = run('git', ['ls-files', '-z']).split('\0').filter(Boolean).filter(f =>
      /^(server\.js|package(-lock)?\.json)$/.test(f) ||
      /^(auth|engine|routes|security|scripts)\/.*\.(js|sh)$/.test(f) ||
      /^db\/.*\.(js|sql)$/.test(f) ||
      /^public\/(?!uploads\/).*\.(html|css|js|png|jpe?g|ico|svg|webp)$/.test(f));
    if (!files.includes('server.js') || !files.includes('package-lock.json')) throw new Error('Missing committed source');
    for (const file of files) {
      if (!fs.lstatSync(file).isFile()) throw new Error('Non-regular source');
      fs.mkdirSync(path.dirname(path.join(stage, file)), { recursive: true });
      fs.copyFileSync(file, path.join(stage, file));
    }
    run('gitleaks', ['dir', stage, '--redact', '--no-banner']);
    run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], stage);
    run('gitleaks', ['dir', stage, '--redact', '--no-banner']);
    run(process.execPath, ['-e', "const D=require('better-sqlite3');new D(':memory:').close();require('sharp')({create:{width:1,height:1,channels:3,background:'red'}}).png().toBuffer().catch(()=>process.exit(1))"], stage);
    fs.writeFileSync(path.join(stage, 'release.json'), JSON.stringify({ version, commit, id, node: process.version, platform: process.platform, arch: process.arch }));
    fs.mkdirSync('dist', { recursive: true });
    const target = path.resolve('dist', `${id}.tar.gz`);
    const temporary = path.join(stage, '..', `${path.basename(stage)}.tar.gz`);
    try {
      run('tar', ['-czf', temporary, '-C', stage, '.']);
      const digest = crypto.createHash('sha256').update(fs.readFileSync(temporary)).digest('hex');
      fs.copyFileSync(temporary, target, fs.constants.COPYFILE_EXCL);
      fs.writeFileSync(`${target}.sha256`, `${digest}  ${path.basename(target)}\n`, { flag: 'wx' });
    } finally { fs.rmSync(temporary, { force: true }); }
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
if (require.main === module) {
  try { main(); } catch { console.error('PACKAGE: failed; no release approved'); process.exitCode = 1; }
}

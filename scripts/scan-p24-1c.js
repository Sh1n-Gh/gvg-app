// Read-only evidence scan of P24.1b fixture artifacts; never opens the live DB.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const Database = require('better-sqlite3');
const {readHandoff, scanPlaintext} = require('../auth/scrub');
const root = path.resolve(__dirname, '..');
const base = path.join(root, 'tmp/p24-1b');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = ['prepared-copy.db', 'scrubbed-clone.db'].map(f => path.join(base, f));
const before = files.map(digest);
const source = new Database(files[0], {readonly:true, fileMustExist:true});
const clone = new Database(files[1], {readonly:true, fileMustExist:true});
const old = source.prepare('SELECT admin_code FROM gyms').all().map(r=>r.admin_code).filter(s=>!/^disabled:[a-f0-9]{64}$/.test(s));
const fresh = readHandoff(path.join(base,'handoff.json'), fs.readFileSync(path.join(base,'handoff.key'))).map(r=>r.password);
const known = [...new Set([...old,...fresh])];
const fixture = ['legacy-private-gym-one','legacy-private-gym-two','legacy-private-gym-deleted','already-created-P24.1a-password','legacy-a','legacy-b'];
const sourceFiles = execFileSync('rg',['--files','--hidden','-g','!.git','-g','!node_modules','-g','!tmp','-g','*.js','-g','*.cjs','-g','*.mjs','-g','*.html','-g','*.sql','-g','*.json','-g','.env.example'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/);
function hits(list, needles) {
  return list.flatMap(file=>fs.readFileSync(path.join(root,file),'utf8').split(/\r?\n/).flatMap((line,i)=>needles.some(s=>line.includes(s))?[{file,line:i+1}]:[]));
}
const report = {
  relatedTests:{command:'node --test --test-concurrency=1 (14 files listed in P24-1C-CHECKPOINT.md)',exitCode:1,pass:86,fail:14,skip:0,cancelled:0,rootFailures:12,parentFailures:2,masterSmoke:{exitCode:0,pass:50,fail:0},fullRegressionRun:false},
  scope:'Working source (including test fixtures), existing P24.1b prepared/scrubbed clones read-only, captured P24.1c stdout/stderr. No live DB, Git history, external backups or unknown/encoded secrets.',
  sourceFiles:sourceFiles.length,
  knownCloneCredentials:known.length,
  knownCloneCredentialSourceHits:hits(sourceFiles,known),
  explicitFixtureCredentialSourceHits:hits(sourceFiles.filter(f=>f.replaceAll('\\','/')!=='scripts/scan-p24-1c.js'),fixture),
  clone:{integrity:clone.pragma('integrity_check',{simple:true}),remainingNonTombstones:clone.prepare('SELECT admin_code FROM gyms').all().filter(r=>!/^disabled:[a-f0-9]{64}$/.test(r.admin_code)).length,allColumnMatches:scanPlaintext(clone,known),fileByteMatches:known.filter(s=>fs.readFileSync(files[1]).includes(Buffer.from(s))).length},
  capturedLogHits:hits(['tmp/p24-1c/tests.txt','tmp/p24-1c/master.txt'],[...known,...fixture]),
  limitation:'Known-value scan only. Test fixtures intentionally contain plaintext samples. Some tests suppress/capture logger output, so stdout/stderr scan does not prove all runtime-generated passwords absent from every internal log.'
};
source.close(); clone.close();
report.clonesUnchanged = files.every((f,i)=>digest(f)===before[i]);
report.artifacts = [...files,path.join(root,'tmp/p24-1c/tests.txt'),path.join(root,'tmp/p24-1c/master.txt')].map(file=>({file:path.relative(root,file),sha256:digest(file)}));
fs.writeFileSync(path.join(root,'docs/P24-1C-RESULTS.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sourceFiles:report.sourceFiles,knownSourceHits:report.knownCloneCredentialSourceHits.length,fixtureSourceHits:report.explicitFixtureCredentialSourceHits.length,clone:report.clone,logHits:report.capturedLogHits.length,clonesUnchanged:report.clonesUnchanged}));

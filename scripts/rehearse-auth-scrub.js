// Intentionally clone-only. A live apply command is NOT provided by this task.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const {scrubCredentials} = require('../auth/scrub');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function rehearse(source, clone, handoffPath, key) {
  source = fs.realpathSync(source);
  clone = path.resolve(clone);
  if (fs.existsSync(clone)) throw new Error('SCRUB: clone must be a new file');
  const sidecars = () => ['-wal','-journal'].some(s => fs.existsSync(source+s) && fs.statSync(source+s).size > 0);
  if (sidecars()) throw new Error('SCRUB: source must be a quiescent, checkpointed offline copy');
  const sourceDigest = digest(source);
  fs.copyFileSync(source,clone,fs.constants.COPYFILE_EXCL);
  if (sidecars() || digest(source) !== sourceDigest || digest(clone) !== sourceDigest) throw new Error('SCRUB: source changed during copy');
  // Only the newly created clone is ever opened by SQLite.
  const db = new Database(clone,{fileMustExist:true});
  try {
    require('../db/migrations').assertCurrent(db);
    db.pragma('foreign_keys=ON');
    db.pragma('synchronous=FULL');
    db.pragma('journal_mode=DELETE');
    const result = await scrubCredentials(db,{handoffPath,key});
    const second = await scrubCredentials(db,{handoffPath,key});
    if (second.changed) throw new Error('SCRUB: idempotence failure');
    if (result.changed) db.exec('VACUUM');
    if (digest(source) !== sourceDigest) throw new Error('SCRUB: source changed externally');
    return {...result,secondRun:second,sourceUnchanged:true,sourceSha256:sourceDigest};
  } finally { db.close(); }
}
if (require.main === module) {
  const [source,clone,handoff,keyFile,...extra] = process.argv.slice(2);
  if (!source || !clone || !handoff || !keyFile || extra.length) {
    console.error('Usage: node scripts/rehearse-auth-scrub.js SOURCE.db NEW_CLONE.db NEW_HANDOFF.json KEY_FILE');
    process.exitCode=1;
  } else {
    rehearse(source,clone,handoff,fs.readFileSync(keyFile)).then(result=>console.log(JSON.stringify(result)))
      .catch(()=>{console.error('SCRUB: rehearsal failed; source was not opened for writing. Inspect clone offline; retain encrypted handoff for recovery.');process.exitCode=1;});
  }
}
module.exports = {rehearse};

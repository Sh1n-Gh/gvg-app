require('dotenv').config({quiet:true});
const fs=require('node:fs');
const path=require('node:path');
const Database=require('better-sqlite3');
const {hashPassword}=require('../auth/password');
async function main() {
  // Password input is one raw UTF-8 value from a pipe/secret manager. Never argv or echoed TTY.
  if(process.argv.length!==2 || process.stdin.isTTY) throw new Error();
  const chunks=[];let size=0;
  for await(const chunk of process.stdin) {size+=chunk.length;if(size>256) throw new Error();chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);
  const password=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const hash=await hashPassword(password);
  const db=new Database(process.env.DB_PATH,{fileMustExist:true});
  try {
    const target=path.resolve(process.env.AUTH_RECOVERY_BACKUP_PATH || '');
    const parent=fs.realpathSync(path.dirname(target));
    const resolved=path.join(parent,path.basename(target));
    const canonical=value=>process.platform==='win32'?value.toLowerCase():value;
    const publicRoot=canonical(fs.realpathSync(path.join(__dirname,'../public')));
    if(!process.env.AUTH_RECOVERY_BACKUP_PATH || fs.existsSync(resolved) || canonical(resolved).startsWith(publicRoot+path.sep)) throw new Error();
    await db.backup(resolved);
    db.transaction(()=>{
      const master=db.prepare("SELECT id FROM auth_principals WHERE role='master'").get();
      if(!master) throw new Error();
      db.prepare(`UPDATE auth_principals SET password_hash=?,password_version=password_version+1,
        session_version=session_version+1,must_rotate=1,disabled_at=NULL,password_changed_at=datetime('now') WHERE id=?`).run(hash,master.id);
      db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE principal_id=?').run(Date.now(),master.id);
    }).immediate();
    console.log('AUTH_RECOVERY: Master credential replaced; sessions revoked');
  } finally {bytes.fill(0);db.close();}
}
main().catch(()=>{console.error('AUTH_RECOVERY: failed; check offline database, new backup path and password input policy');process.exitCode=1;});

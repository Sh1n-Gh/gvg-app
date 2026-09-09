const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const Database = require('better-sqlite3');
const {createDb} = require('../db');
const {createApp} = require('../server');
const {migrateCredentials} = require('../auth/migrate');
const {scrubCredentials,scanPlaintext,readHandoff} = require('../auth/scrub');
const {rehearse} = require('../scripts/rehearse-auth-scrub');
const pw = require('../auth/password');
const oldPasswords = ['legacy-private-gym-one','legacy-private-gym-two','legacy-private-gym-deleted'];
const masterPassword = 'fixture Master password only';
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const rows = db => JSON.stringify(['gyms','auth_principals','auth_sessions'].map(name=>db.prepare(`SELECT * FROM ${name}`).all()));
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'gvg-scrub-'));
  const cleanup = [];
  t.after(async()=>{ for(const close of cleanup.reverse()) await close(); fs.rmSync(dir,{recursive:true,force:true}); });
  const source = path.join(dir,'source.db');
  const db = createDb(source);
  oldPasswords.forEach((code,i)=>db.prepare('INSERT INTO gyms(name,slug,admin_code) VALUES (?,?,?)').run('Gym '+i,'gym-'+i,code));
  db.prepare("UPDATE gyms SET deleted_at=datetime('now') WHERE id=3").run();
  await migrateCredentials(db,{env:{MASTER_ADMIN_CODE:masterPassword},backupPath:path.join(dir,'backup.db')});
  const newPassword = 'already-created-P24.1a-password';
  db.prepare('INSERT INTO gyms(name,slug,admin_code) VALUES (?,?,?)').run('New Gym','new-gym','disabled:'+crypto.randomBytes(32).toString('hex'));
  db.prepare("INSERT INTO auth_principals(role,gym_id,password_hash,must_rotate) VALUES ('gym',4,?,1)").run(await pw.hashPassword(newPassword));
  db.close();
  const clone = path.join(dir,'clone.db');
  fs.copyFileSync(source,clone,fs.constants.COPYFILE_EXCL);
  return {cleanup,dir,source,clone,key:crypto.randomBytes(32),handoffPath:path.join(dir,'handoff.json'),newPassword};
}
async function serve(f,db) {
  const app = createApp(db,{env:{SESSION_SECRETS:'s'.repeat(32),AUTH_RATE_LIMIT_SECRET:'r'.repeat(32)},logger:{log(){}}});
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  f.cleanup.push(async()=>{app.locals.auth.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (url,body,session) => {
    const response = await fetch(base+url,{method:body?'POST':'GET',headers:{Origin:base,
      ...(body?{'Content-Type':'application/json'}:{}),...(session?{Cookie:session.cookie,'X-CSRF-Token':session.data.csrf_token}:{})},
      body:body?JSON.stringify(body):undefined});
    const text = await response.text();
    return {status:response.status,data:text?JSON.parse(text):null,cookie:response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};
  };
}
test('clone scrub: all columns clean, login/change/reset/revoke, deleted gym, exact second-run no-op, source unchanged',async t=>{
  const f = await fixture(t), sourceBefore = sha(f.source);
  const db = new Database(f.clone); f.cleanup.push(()=>db.close());
  const request = await serve(f,db);
  const master = await request('/master/auth/login',{password:masterPassword}); assert.equal(master.status,200);
  const oldSession = await request('/g/gym-0/admin/auth/login',{password:oldPasswords[0]}); assert.equal(oldSession.status,200);
  const already = db.prepare('SELECT * FROM auth_principals WHERE gym_id=4').get();
  const result = await scrubCredentials(db,f);
  assert.deepEqual(result,{before:3,scrubbed:3,after:0,changed:true});
  const credentials = readHandoff(f.handoffPath,f.key);
  assert.equal(credentials.length,3);
  assert.equal(scanPlaintext(db,[...oldPasswords,...credentials.map(c=>c.password),f.newPassword]),0);
  assert.equal(await request('/g/gym-0/admin/auth/session',null,oldSession).then(r=>r.status),401);
  assert.equal(await request('/master/auth/session',null,master).then(r=>r.status),200);
  assert.deepEqual(db.prepare('SELECT * FROM auth_principals WHERE gym_id=4').get(),already);
  const beforeSecond=rows(db),handoffBefore=sha(f.handoffPath),fileBefore=sha(f.clone);
  assert.deepEqual(await scrubCredentials(db,{...f,hash:()=>{throw new Error('must not hash again');}}),{before:0,scrubbed:0,after:0,changed:false});
  assert.equal(rows(db),beforeSecond); assert.equal(sha(f.handoffPath),handoffBefore); assert.equal(sha(f.clone),fileBefore);
  for (const c of credentials) {
    const p=db.prepare('SELECT * FROM auth_principals WHERE gym_id=?').get(c.gymId);
    assert.ok(await pw.verifyPassword(c.password,p.password_hash)); assert.equal(p.must_rotate,1);
    assert.equal(p.password_version,2); assert.equal(p.session_version,2);
    if(c.gymId===3) {assert.equal((await request('/g/'+c.slug+'/admin/auth/login',{password:c.password})).status,404);continue;}
    assert.equal((await request('/g/'+c.slug+'/admin/auth/login',{password:oldPasswords[c.gymId-1]})).status,401);
    assert.equal((await request('/g/'+c.slug+'/admin/auth/login',{password:db.prepare('SELECT admin_code FROM gyms WHERE id=?').get(c.gymId).admin_code})).status,401);
    const login=await request('/g/'+c.slug+'/admin/auth/login',{password:c.password}); assert.equal(login.status,200);
    const changed=await request('/g/'+c.slug+'/admin/auth/change-password',{current_password:c.password,new_password:'new permanent password '+c.gymId},login);
    assert.equal(changed.status,200); assert.equal(changed.data.must_rotate,false);
    const reset=await request('/master/gyms/'+c.gymId+'/admin-password/reset',{},master); assert.equal(reset.status,200);
    assert.equal((await request('/g/'+c.slug+'/admin/auth/session',null,changed)).status,401);
    assert.equal((await request('/g/'+c.slug+'/admin/auth/login',{password:reset.data.temporary_password})).status,200);
  }
  assert.equal((await request('/g/new-gym/admin/auth/login',{password:f.newPassword})).status,200);
  assert.equal(sha(f.source),sourceBefore);
});
test('SQL interruption after first gym rolls back every credential and session; retry and backup restore work',async t=>{
  const f=await fixture(t), db=new Database(f.clone); f.cleanup.push(()=>db.close());
  const before=rows(db);
  await assert.rejects(scrubCredentials(db,{...f,afterWrite:n=>{if(n===1)throw new Error('interrupted');}}),/interrupted/);
  assert.equal(rows(db),before);
  for(let i=0;i<3;i++) assert.ok(await pw.verifyPassword(oldPasswords[i],db.prepare('SELECT password_hash FROM auth_principals WHERE gym_id=?').get(i+1).password_hash));
  assert.equal((await scrubCredentials(db,{...f,handoffPath:path.join(f.dir,'retry.json')})).scrubbed,3);
  const restored=path.join(f.dir,'restored.db');fs.copyFileSync(f.source,restored);
  const restore=new Database(restored);try{assert.equal(rows(restore),before);}finally{restore.close();}
});
test('process termination mid-transaction recovers all gyms; termination after commit retains decryptable credentials',async t=>{
  const f=await fixture(t); let db=new Database(f.clone);const before=rows(db);db.close();
  const script=`const D=require('better-sqlite3');const {scrubCredentials}=require('./auth/scrub');
    const db=new D(process.argv[1]);scrubCredentials(db,{handoffPath:process.argv[2],key:Buffer.from(process.argv[3],'hex'),
    afterWrite:n=>{if(n===1)process.exit(77)}}).catch(()=>process.exit(78));`;
  const child=spawnSync(process.execPath,['-e',script,f.clone,f.handoffPath,f.key.toString('hex')],{cwd:path.join(__dirname,'..')});
  assert.equal(child.status,77);db=new Database(f.clone);assert.equal(rows(db),before);db.close();
  const after=path.join(f.dir,'committed.json');
  const committed=spawnSync(process.execPath,['-e',script.replace('if(n===1)process.exit(77)','').replace('.catch(()=>process.exit(78))','.then(()=>process.exit(79)).catch(()=>process.exit(78))'),f.clone,after,f.key.toString('hex')],{cwd:path.join(__dirname,'..')});
  assert.equal(committed.status,79); db=new Database(f.clone);f.cleanup.push(()=>db.close());
  for(const c of readHandoff(after,f.key)) assert.ok(await pw.verifyPassword(c.password,db.prepare('SELECT password_hash FROM auth_principals WHERE gym_id=?').get(c.gymId).password_hash));
  assert.equal((await scrubCredentials(db)).changed,false);
});
test('unexpected plaintext in JSON/blob rolls back; handoff failure and concurrent changes do not partially scrub',async t=>{
  const f=await fixture(t),db=new Database(f.clone);f.cleanup.push(()=>db.close());
  db.exec('CREATE TABLE extra_copy(json TEXT,bytes BLOB)');
  db.prepare('INSERT INTO extra_copy VALUES (?,?)').run(JSON.stringify({secret:oldPasswords[0]}),Buffer.from(oldPasswords[1]));
  const before=rows(db);
  await assert.rejects(scrubCredentials(db,f),/plaintext remains/);assert.equal(rows(db),before);
  db.exec('DELETE FROM extra_copy');
  await assert.rejects(scrubCredentials(db,f),/EEXIST/);assert.equal(rows(db),before);
  let calls=0;
  await assert.rejects(scrubCredentials(db,{...f,handoffPath:path.join(f.dir,'race.json'),hash:async password=>{
    if(++calls===1)db.prepare('UPDATE auth_principals SET session_version=session_version+1 WHERE gym_id=1').run();
    return pw.hashPassword(password);
  }}),/concurrent/);
  assert.deepEqual(db.prepare('SELECT admin_code FROM gyms WHERE id<4 ORDER BY id').all().map(g=>g.admin_code),oldPasswords);
});
test('clone-only CLI helper rejects existing target and WAL source; source bytes unchanged; physical clone scan',async t=>{
  const f=await fixture(t),before=sha(f.source),target=path.join(f.dir,'rehearsal.db');
  await assert.rejects(rehearse(f.source,f.source,f.handoffPath,f.key),/new file/);
  fs.writeFileSync(f.source+'-wal','not checkpointed');
  await assert.rejects(rehearse(f.source,target,f.handoffPath,f.key),/checkpointed/);fs.unlinkSync(f.source+'-wal');
  const result=await rehearse(f.source,target,f.handoffPath,f.key);
  assert.equal(result.before,3);assert.equal(result.after,0);assert.equal(result.secondRun.changed,false);assert.equal(sha(f.source),before);
  for(const secret of [...oldPasswords,...readHandoff(f.handoffPath,f.key).map(c=>c.password)]) assert.equal(fs.readFileSync(target).includes(Buffer.from(secret)),false);
  const keyFile=path.join(f.dir,'key');fs.writeFileSync(keyFile,f.key,{mode:0o600});
  const cli=spawnSync(process.execPath,[path.join(__dirname,'../scripts/rehearse-auth-scrub.js'),f.source,path.join(f.dir,'cli.db'),path.join(f.dir,'cli-handoff.json'),keyFile],{encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).scrubbed,3);
  assert.equal(sha(f.source),before);
});
test('preflight rejects missing/invalid principals; additive migration never hashes a tombstone',async t=>{
  const f=await fixture(t),db=new Database(f.clone);f.cleanup.push(()=>db.close());
  db.prepare('DELETE FROM auth_principals WHERE gym_id=4').run();
  const before=rows(db);await assert.rejects(scrubCredentials(db,f),/additive/);assert.equal(rows(db),before);
  await assert.rejects(migrateCredentials(db,{env:{},backupPath:path.join(f.dir,'offline-backup.db')}),/AUTH_MIGRATION/);
  assert.equal(rows(db),before);
});
test('hash failure leaves clone untouched; forged tombstone cannot silently count as scrubbed',async t=>{
  const f=await fixture(t),db=new Database(f.clone);f.cleanup.push(()=>db.close());
  const before=rows(db);
  await assert.rejects(scrubCredentials(db,{...f,hash:async()=>{throw new Error('hash failed');}}),/hash failed/);
  assert.equal(rows(db),before);assert.equal(fs.existsSync(f.handoffPath),false);
  const value=db.prepare('SELECT admin_code FROM gyms WHERE id=4').get().admin_code;
  db.prepare('UPDATE auth_principals SET password_hash=? WHERE gym_id=4').run(await pw.hashPassword(value));
  await assert.rejects(scrubCredentials(db,f),/tombstone authenticates/);
});


const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createDb}=require('../db');
const {createApp}=require('../server');
const {migrateCredentials}=require('../auth/migrate');
const {TTL,SQLiteSessionStore,digest}=require('../auth/session-store');
const {createLimiter}=require('../auth/rate-limit');
const masterPassword='test master password';
async function fixture(env={},secure=false) {
  const db=createDb(':memory:');
  for(const slug of ['a','b']) db.prepare('INSERT INTO gyms(name,slug,admin_code) VALUES (?,?,?)').run(slug,slug,`legacy-${slug}`);
  await migrateCredentials(db,{env:{MASTER_ADMIN_CODE:masterPassword}});
  let time=Date.now();
  const config={SESSION_SECRETS:'s'.repeat(32),AUTH_RATE_LIMIT_SECRET:'r'.repeat(32),...env};
  const logs=[];
  const logger=require('../security/observability').createLogger(config,line=>logs.push(line));
  const app=createApp(db,{env:config,now:()=>time,logger});
  const server=http.createServer((req,res)=>{ if(secure) { req.headers.host=new URL(config.PUBLIC_ORIGIN).host; req.headers['x-forwarded-host']=req.headers.host; req.headers['x-forwarded-proto']='https'; } app(req,res); });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(url,{method='GET',cookie,csrf,body,headers={},origin=config.PUBLIC_ORIGIN||base}={}) {
    const response=await fetch(base+url,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),
      ...(csrf?{'X-CSRF-Token':csrf}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},
      body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
    const text=await response.text();
    let data;try{data=JSON.parse(text);}catch{data=text;}
    return {status:response.status,data,headers:response.headers,cookie:response.headers.getSetCookie().filter(v=>!v.includes('Expires=Thu, 01 Jan 1970')).map(v=>v.split(';')[0]).join('; ')};
  }
  async function login(role='master',slug='a',cookie) {
    const prefix=role==='master'?'/master':`/g/${slug}/admin`;
    const result=await request(prefix+'/auth/login',{method:'POST',cookie,body:{password:role==='master'?masterPassword:`legacy-${slug}`}});
    assert.equal(result.status,200);return {...result,prefix,csrf:result.data.csrf_token};
  }
  return {db,app,logs,request,login,advance:ms=>time+=ms,now:()=>time,
    close:async()=>{app.locals.auth.close();await new Promise(resolve=>server.close(resolve));db.close();}};
}

function seedCreationTemplate(db) {
  db.exec(`INSERT INTO season_templates(id,name,is_active,last_defined_round_number,battle_start_at,ticket_day1_amount,ticket_daily_amount,ticket_regen_days)
    VALUES (1,'creation test',1,1,'2026-01-01',10,1,1);
    INSERT INTO season_template_rounds(season_template_id,round_number,max_score,order_index) VALUES (1,1,100,1);
    INSERT INTO season_template_maps(season_template_id,name,order_index) VALUES (1,'map',1);`);
}

test('P24.1a create stores only hash and independent tombstone; temporary login/reset and no disclosure',async()=>{
  const f=await fixture({LEGACY_AUTH_ENABLED:'1'});try{
    seedCreationTemplate(f.db);
    const m=await f.login();
    const create=()=>f.request('/master/gyms',{method:'POST',cookie:m.cookie,csrf:m.csrf,
      body:{name:'New gym',slug:'new-gym',admin_code:'legacy-a'}});
    const result=await create();
    assert.equal(result.status,200);
    assert.equal(result.headers.get('cache-control'),'no-store');
    const temporary=result.data.gym.admin_code;
    assert.match(temporary,/^[A-Za-z0-9_-]{43}$/);
    const row=f.db.prepare('SELECT admin_code FROM gyms WHERE id=?').get(result.data.gym.id);
    assert.match(row.admin_code,/^disabled:[a-f0-9]{64}$/);
    assert.equal(row.admin_code===temporary,false);
    const principal=f.db.prepare('SELECT password_hash,must_rotate FROM auth_principals WHERE gym_id=?').get(result.data.gym.id);
    assert.match(principal.password_hash,/^\$argon2id\$/);
    assert.equal(principal.must_rotate,1);
    const login=await f.request('/g/new-gym/admin/auth/login',{method:'POST',body:{password:temporary}});
    assert.equal(login.status,200);assert.equal(login.data.must_rotate,true);
    for(const password of ['legacy-a',row.admin_code,'incorrect']) {
      const denied=await f.request('/g/new-gym/admin/auth/login',{method:'POST',body:{password}});
      assert.equal(denied.status,401);
      assert.equal(JSON.stringify(denied.data).includes(password),false);
    }
    assert.equal((await f.request('/g/new-gym/admin/verify',{headers:{'x-admin-code':row.admin_code}})).status,404);
    assert.equal((await f.request('/g/new-gym/admin/members',{headers:{'x-admin-code':row.admin_code}})).status,401);
    const list=await f.request('/master/gyms',{cookie:m.cookie});
    assert.equal(JSON.stringify(list.data).includes(temporary),false);
    assert.ok(list.data.every(g=>!('admin_code' in g)&&!('password_hash' in g)));
    const retry=await create();assert.equal(retry.status,409);
    assert.equal(JSON.stringify(retry.data).includes(temporary),false);
    const reset=await f.request(`/master/gyms/${result.data.gym.id}/admin-password/reset`,{method:'POST',cookie:m.cookie,csrf:m.csrf,body:{}});
    assert.equal(reset.status,200);
    assert.equal((await f.request('/g/new-gym/admin/auth/session',{cookie:login.cookie})).status,401);
    assert.equal((await f.request('/g/new-gym/admin/auth/login',{method:'POST',body:{password:temporary}})).status,401);
    assert.equal((await f.request('/g/new-gym/admin/auth/login',{method:'POST',body:{password:reset.data.temporary_password}})).status,200);
    // Includes every SQLite page, rather than only the credential columns.
    for(const secret of [temporary,reset.data.temporary_password]) {
      assert.equal(f.db.serialize().includes(Buffer.from(secret)),false);
      assert.equal(f.logs.join('').includes(secret),false);
    }
    assert.equal(f.db.prepare("SELECT admin_code FROM gyms WHERE slug='a'").get().admin_code,'legacy-a');
  }finally{await f.close();}
});

test('P24.1a every creation write rolls back on principal, season or round failure',async()=>{
  const f=await fixture();try{
    seedCreationTemplate(f.db);const m=await f.login();
    const tables=['gyms','auth_principals','gym_seasons','gym_round_status','gym_round_map_progress'];
    const counts=()=>tables.map(table=>f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n);
    const before=counts();
    for(const table of ['auth_principals','gym_seasons','gym_round_status']) {
      f.db.exec(`CREATE TRIGGER creation_failure AFTER INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'private failure'); END`);
      try{
        const result=await f.request('/master/gyms',{method:'POST',cookie:m.cookie,csrf:m.csrf,body:{name:'Rollback gym'}});
        assert.equal(result.status,409,table);
        assert.deepEqual(counts(),before,table);
        assert.equal(JSON.stringify(result.data).includes('private failure'),false);
        assert.equal('gym' in result.data,false);
      }finally{f.db.exec('DROP TRIGGER creation_failure');}
    }
  }finally{await f.close();}
});

test('login/session, cookie isolation, fixation rotation, opaque store and logout',async()=>{
  const f=await fixture();try {
    assert.equal((await f.request('/master/auth/session')).status,401);
    assert.equal((await f.request('/master/auth/login',{method:'POST',body:{password:'incorrect'}})).status,401);
    const master=await f.login();const gym=await f.login('gym');
    const header=master.headers.get('set-cookie');
    assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Lax/);assert.match(header,/Path=\//);assert.doesNotMatch(header,/Secure/);
    assert.match(master.cookie,/gvg_master_session=/);assert.match(gym.cookie,/gvg_gym_session=/);
    const both=master.cookie+'; '+gym.cookie;
    assert.equal((await f.request('/master/auth/session',{cookie:both})).data.role,'master');
    assert.equal((await f.request('/g/a/admin/auth/session',{cookie:both})).data.role,'gym');
    const row=f.db.prepare("SELECT * FROM auth_sessions WHERE namespace='master'").get();
    assert.equal(row.sid_hash.length,32);assert.equal(row.session_json.includes(masterPassword),false);
    assert.equal(row.session_json.includes('password_hash'),false);
    const rotated=await f.login('master','a',master.cookie);
    assert.notEqual(rotated.cookie,master.cookie);assert.notEqual(rotated.csrf,master.csrf);
    assert.equal((await f.request('/master/auth/session',{cookie:master.cookie})).status,401);
    assert.equal((await f.request('/master/auth/logout',{method:'POST',cookie:rotated.cookie})).status,403);
    assert.equal((await f.request('/master/auth/logout',{method:'POST',cookie:rotated.cookie,csrf:rotated.csrf})).status,204);
    assert.equal((await f.request('/master/auth/session',{cookie:rotated.cookie})).status,401);
    assert.equal((await f.request('/master/auth/logout',{method:'POST',cookie:rotated.cookie})).status,204);
    assert.equal((await f.request('/g/a/admin/auth/session',{cookie:gym.cookie})).status,200);
  }finally{await f.close();}
});

test('role/cross-gym isolation including session-preferred legacy and soft delete',async()=>{
  const f=await fixture({LEGACY_AUTH_ENABLED:'1'});try{
    const a=await f.login('gym');const m=await f.login();
    assert.equal((await f.request('/master/gyms',{cookie:a.cookie})).status,401);
    assert.equal((await f.request('/g/a/admin/members',{cookie:m.cookie})).status,401);
    assert.equal((await f.request('/g/b/admin/members',{cookie:a.cookie,headers:{'x-admin-code':'legacy-b'}})).status,403);
    assert.equal((await f.request('/g/b/admin/members/bulk',{method:'POST',cookie:a.cookie,csrf:a.csrf,body:{members:[{name:'intruder'}]}})).status,403);
    assert.equal((await f.request('/g/a/admin/members',{cookie:a.cookie})).status,200);
    f.db.prepare("UPDATE gyms SET deleted_at=datetime('now') WHERE slug='a'").run();
    assert.equal((await f.request('/g/a/admin/auth/session',{cookie:a.cookie})).status,404);
  }finally{await f.close();}
});

test('CSRF and Origin guard every Master mutation including raw upload; no writes on rejection',async()=>{
  const f=await fixture();try{
    const m=await f.login();
    const paths=[['POST','/master/gyms'],['PATCH','/master/gyms/1/delete'],['PATCH','/master/gyms/1/restore'],
      ['PATCH','/master/gyms/1/slug'],['PATCH','/master/season-templates/1/activate'],['POST','/master/map-images'],
      ['POST','/master/gyms/1/admin-password/reset'],['POST','/master/auth/change-password']];
    for(const [method,url] of paths) {
      assert.equal((await f.request(url,{method,cookie:m.cookie,body:{}})).status,403,url);
      assert.equal((await f.request(url,{method,cookie:m.cookie,csrf:'wrong',body:{}})).status,403,url);
      assert.equal((await f.request(url,{method,cookie:m.cookie,csrf:m.csrf,origin:'https://evil.test',body:{}})).status,403,url);
    }
    assert.equal(f.db.prepare('SELECT count(*) n FROM gyms WHERE deleted_at IS NOT NULL').get().n,0);
    assert.equal((await f.request('/master/gyms/1/delete',{method:'PATCH',cookie:m.cookie,csrf:m.csrf,body:{}})).status,200);
    assert.equal((await f.request('/master/auth/login',{method:'POST',origin:'null',body:{password:masterPassword}})).status,403);
    assert.equal((await f.request('/master/auth/login',{method:'POST',body:{password:'x'.repeat(10000)}})).status,413);
  }finally{await f.close();}
});

test('idle/absolute expiry, version and disabled principal invalidate sessions',async()=>{
  for(const kind of ['idle','absolute','version','disabled','revoked']) {
    const f=await fixture();try{
      const m=await f.login();
      if(kind==='idle') f.advance(TTL.master.idle+1);
      if(kind==='absolute') {
        for(let i=0;i<17;i++) {f.advance(29*60e3);await f.request('/master/auth/session',{cookie:m.cookie});}
      }
      if(kind==='version') f.db.prepare("UPDATE auth_principals SET session_version=session_version+1 WHERE role='master'").run();
      if(kind==='disabled') f.db.prepare("UPDATE auth_principals SET disabled_at=datetime('now') WHERE role='master'").run();
      if(kind==='revoked') f.db.prepare('UPDATE auth_sessions SET revoked_at=?').run(f.now());
      const denied=await f.request('/master/auth/session',{cookie:m.cookie});
      assert.equal(denied.status,401,kind);assert.match(denied.headers.get('set-cookie'),/Expires=Thu, 01 Jan 1970/);
    }finally{await f.close();}
  }
});

test('password change rotates credentials/CSRF and revokes other sessions, login ignores plaintext',async()=>{
  const f=await fixture({LEGACY_AUTH_ENABLED:'1'});try{
    const a=await f.login('gym'),other=await f.login('gym');
    const changed=await f.request('/g/a/admin/auth/change-password',{method:'POST',cookie:a.cookie,csrf:a.csrf,
      body:{current_password:'legacy-a',new_password:'a new long password'}});
    assert.equal(changed.status,200);assert.notEqual(changed.data.csrf_token,a.csrf);assert.equal(changed.data.must_rotate,false);
    assert.equal((await f.request('/g/a/admin/auth/session',{cookie:other.cookie})).status,401);
    assert.equal((await f.request('/g/a/admin/auth/login',{method:'POST',body:{password:'legacy-a'}})).status,401);
    assert.equal((await f.request('/g/a/admin/auth/login',{method:'POST',body:{password:'a new long password'}})).status,200);
    assert.equal(f.db.prepare("SELECT admin_code FROM gyms WHERE slug='a'").get().admin_code,'legacy-a');
  }finally{await f.close();}
});

test('Master reset is recent-auth protected, temporary credential works and old session revoked',async()=>{
  const f=await fixture();try{
    const m=await f.login(),a=await f.login('gym');f.advance(11*60e3);
    const url='/master/gyms/1/admin-password/reset';
    assert.equal((await f.request(url,{method:'POST',cookie:m.cookie,csrf:m.csrf,body:{current_password:'wrong'}})).status,401);
    const reset=await f.request(url,{method:'POST',cookie:m.cookie,csrf:m.csrf,body:{current_password:masterPassword}});
    assert.equal(reset.status,200);assert.equal(reset.headers.get('cache-control'),'no-store');
    assert.equal((await f.request('/g/a/admin/auth/session',{cookie:a.cookie})).status,401);
    const login=await f.request('/g/a/admin/auth/login',{method:'POST',body:{password:reset.data.temporary_password}});
    assert.equal(login.status,200);assert.equal(login.data.must_rotate,true);
  }finally{await f.close();}
});

test('legacy removed regardless of old flag; headers grant no access and cannot bypass CSRF',async()=>{
  for(const enabled of ['0','1']) {
    const f=await fixture({LEGACY_AUTH_ENABLED:enabled});try{
      const result=await f.request('/master/verify',{headers:{'x-master-admin-code':masterPassword}});
      assert.equal(result.status,404);assert.equal(result.cookie,'');
      assert.equal((await f.request('/master/gyms',{headers:{'x-master-admin-code':masterPassword}})).status,401);
      assert.equal((await f.request('/g/a/admin/verify',{headers:{'x-admin-code':'legacy-a'}})).status,404);
      assert.equal((await f.request('/g/a/admin/members',{headers:{'x-admin-code':'legacy-a'}})).status,401);
      const m=await f.login();
      assert.equal((await f.request('/master/gyms/1/delete',{method:'PATCH',cookie:m.cookie,headers:{'x-master-admin-code':masterPassword},body:{}})).status,403);
    }finally{await f.close();}
  }
});

test('rate limit before hashing, Retry-After and SQLite state survive limiter recreation',async()=>{
  const f=await fixture();try{
    for(let i=0;i<5;i++) assert.equal((await f.request('/master/auth/login',{method:'POST',body:{password:'wrong'}})).status,401);
    const blocked=await f.request('/master/auth/login',{method:'POST',body:{password:masterPassword}});
    assert.equal(blocked.status,429);assert.equal(Number(blocked.headers.get('retry-after')),900);
    assert.ok(f.db.prepare('SELECT bucket_hash FROM auth_rate_limits').all().every(r=>r.bucket_hash.length===32));
    const limiter=createLimiter(f.db,'r'.repeat(32),f.now);
    assert.equal(limiter.reserve('master','127.0.0.1','master').retry,900);
    f.advance(15*60e3+1);assert.equal((await f.login()).status,200);
  }finally{await f.close();}
});

test('production Secure cookie and exact Origin/HTTPS Referer fallback using TLS-terminated request harness',async()=>{
  const f=await fixture({NODE_ENV:'production',TRUST_PROXY:'127.0.0.1',PUBLIC_ORIGIN:'https://gvg.test'},true);try{
    const m=await f.login();const cookie=m.headers.get('set-cookie');
    assert.match(cookie,/__Host-gvg_master_session=/);assert.match(cookie,/; Secure/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);assert.doesNotMatch(cookie,/Domain=/);
    assert.equal((await f.request('/master/auth/logout',{method:'POST',cookie:m.cookie,csrf:m.csrf,origin:'',headers:{Referer:'https://gvg.test/master'}})).status,204);
    assert.equal((await f.request('/master/auth/login',{method:'POST',origin:'',headers:{Referer:'http://gvg.test/master'},body:{password:masterPassword}})).status,403);
  }finally{await f.close();}
});

test('store throttles touch and never revives revoked sessions',async()=>{
  const f=await fixture();try{
    const m=await f.login();const store=new SQLiteSessionStore(f.db,'master',f.now);
    const signed=decodeURIComponent(m.cookie.split('=')[1]);const sid=signed.slice(2,signed.lastIndexOf('.'));
    const get=()=>f.db.prepare('SELECT * FROM auth_sessions WHERE sid_hash=?').get(digest(sid));
    const original=get();
    f.advance(60e3);await f.request('/master/auth/session',{cookie:m.cookie});assert.equal(get().last_seen_at,original.last_seen_at);
    f.advance(5*60e3);await f.request('/master/auth/session',{cookie:m.cookie});assert.ok(get().last_seen_at>original.last_seen_at);
    const data=await new Promise((resolve,reject)=>store.get(sid,(err,value)=>err?reject(err):resolve(value)));
    store.destroy(sid);store.set(sid,data);assert.ok(get().revoked_at);
  }finally{await f.close();}
});

test('Gym mutations require CSRF and tenant-scoped member IDs cannot cross gyms',async()=>{
  const f=await fixture();try{
    f.db.exec(`INSERT INTO season_templates(id,name,is_active,last_defined_round_number,battle_start_at,ticket_day1_amount,ticket_daily_amount,ticket_regen_days)
      VALUES (1,'test',1,1,'2026-01-01',10,1,1);
      INSERT INTO gym_seasons(id,gym_id,season_template_id) VALUES (1,1,1),(2,2,1);
      INSERT INTO members(id,gym_season_id,name) VALUES (1,1,'a member'),(2,2,'b member');`);
    const a=await f.login('gym');
    for(const [method,path] of [['POST','/members/bulk'],['PATCH','/members/1'],['PATCH','/members/1/ban'],
      ['POST','/entries'],['PATCH','/entries/1'],['DELETE','/entries/1'],['POST','/season-switch']]) {
      assert.equal((await f.request('/g/a/admin'+path,{method,cookie:a.cookie,body:{}})).status,403,path);
    }
    assert.equal((await f.request('/g/a/admin/members/2',{method:'PATCH',cookie:a.cookie,csrf:a.csrf,body:{name:'intruder'}})).status,404);
    assert.equal((await f.request('/g/a/admin/members/1',{method:'PATCH',cookie:a.cookie,csrf:a.csrf,body:{name:'updated'}})).status,200);
    assert.equal(f.db.prepare('SELECT name FROM members WHERE id=2').get().name,'b member');
  }finally{await f.close();}
});

test('signing key rotation accepts previous key, signs current key; cookie renaming grants no role',async()=>{
  const signature=require('cookie-signature');const current='n'.repeat(32),previous='o'.repeat(32);
  for(const keys of [current+','+previous,current]) {
    const f=await fixture({SESSION_SECRETS:keys});try{
      const m=await f.login();const raw=decodeURIComponent(m.cookie.split('=')[1]);
      const sid=signature.unsign(raw.slice(2),current);assert.ok(sid);
      const old='gvg_master_session='+encodeURIComponent('s:'+signature.sign(sid,previous));
      const result=await f.request('/master/auth/session',{cookie:old});
      assert.equal(result.status,keys.includes(',')?200:401);
      if(result.status===200) assert.equal(signature.unsign(decodeURIComponent(result.cookie.split('=')[1]).slice(2),current),sid);
      assert.equal((await f.request('/g/a/admin/auth/session',{cookie:m.cookie.replace('gvg_master_session','gvg_gym_session')})).status,401);
    }finally{await f.close();}
  }
});

test('rate limiter concurrent reservations are bounded and repeated blocks escalate to one hour',async()=>{
  const db=createDb(':memory:');let time=Date.now();try{
    const limiter=createLimiter(db,'r'.repeat(32),()=>time);
    for(const duration of [900,1800,3600]) {
      const tickets=Array.from({length:5},()=>limiter.reserve('master','test-ip','master'));
      assert.ok(tickets.every(t=>!t.retry));assert.ok(limiter.reserve('master','test-ip','master').retry);
      tickets.forEach(t=>limiter.finish(t,false));
      assert.equal(limiter.reserve('master','test-ip','master').retry,duration);
      time+=(duration+1)*1000;
    }
  }finally{db.close();}
});

test('offline recovery backs up and replaces Master hash, revokes sessions, never prints input',async()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {spawnSync}=require('node:child_process');
  const {hashPassword,verifyPassword}=require('../auth/password');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p04-recovery-'));
  const filename=path.join(dir,'auth.db');const db=createDb(filename);
  try{
    db.prepare("INSERT INTO auth_principals(role,password_hash) VALUES ('master',?)").run(await hashPassword(masterPassword));
    const store=new SQLiteSessionStore(db,'master');const now=Date.now();
    store.set('test-sid',{cookie:{},auth:{principalId:1,role:'master',gymId:null,version:1,createdAt:now,absoluteAt:now+3600e3,csrf:'test'}});
    const input='recovered password 🔑';
    const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/recover-master.js')],{
      env:{...process.env,DB_PATH:filename,AUTH_RECOVERY_BACKUP_PATH:path.join(dir,'backup.db')},input,encoding:'utf8',timeout:5000});
    assert.equal(result.status,0);assert.equal((result.stdout+result.stderr).includes(input),false);
    const p=db.prepare('SELECT * FROM auth_principals').get();
    assert.equal(await verifyPassword(input,p.password_hash),true);assert.equal(p.must_rotate,1);
    assert.equal(p.session_version,2);assert.ok(db.prepare('SELECT revoked_at FROM auth_sessions').get().revoked_at);
    const backup=require('better-sqlite3')(path.join(dir,'backup.db'));
    try{assert.equal(await verifyPassword(masterPassword,backup.prepare('SELECT password_hash FROM auth_principals').get().password_hash),true);}finally{backup.close();}
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('development accepts empty example secrets; production requires configured HTTPS origin',async()=>{
  const f=await fixture({SESSION_SECRETS:'',AUTH_RATE_LIMIT_SECRET:''});
  try{assert.equal((await f.login()).status,200);}finally{await f.close();}
  const {validateConfig}=require('../auth/config');const db=createDb(':memory:');
  try{
    for(const value of ['', 'http://example.test','https://example.test/']) {
      assert.throws(()=>validateConfig(db,{NODE_ENV:'production',SESSION_SECRETS:'s'.repeat(32),AUTH_RATE_LIMIT_SECRET:'r'.repeat(32),
        MASTER_ADMIN_CODE:'bootstrap-fixture',PUBLIC_ORIGIN:value}),/PUBLIC_ORIGIN/);
    }
  }finally{db.close();}
});

test('known gym without principal uses generic failure; malformed login does not expose internals',async()=>{
  const f=await fixture();try{
    f.db.prepare("DELETE FROM auth_principals WHERE role='gym' AND gym_id=2").run();
    const missing=await f.request('/g/b/admin/auth/login',{method:'POST',body:{password:'unknown'}});
    const wrong=await f.request('/g/a/admin/auth/login',{method:'POST',body:{password:'unknown'}});
    assert.equal(missing.status,401);
    assert.notEqual(missing.data.request_id,wrong.data.request_id);
    assert.deepEqual({...missing.data,request_id:undefined},{...wrong.data,request_id:undefined});
    assert.equal(missing.headers.get('cache-control'),'no-store');
    assert.equal((await f.request('/master/auth/login',{method:'POST',body:{password:42}})).status,400);
  }finally{await f.close();}
});

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Worker} = require('node:worker_threads');
const {once} = require('node:events');
const {performance} = require('node:perf_hooks');
const {createDb} = require('../db');
const engine = require('../engine');
const {seed} = require('./p18-fixture');
function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gvg-p18-test-'));
  const filename=path.join(dir,'fixture.db');
  const db=createDb(filename,{env:{}});seed(db);
  return {db,filename,close(){db.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
function worker(filename,mode,ms) {
  const w=new Worker(path.join(__dirname,'p18-worker.js'),{workerData:{filename,mode,ms}});
  // Attach completion listeners immediately, so synchronous work cannot race them.
  w.done=new Promise((resolve,reject)=>{w.on('message',m=>{if(m.error)reject(new Error(m.error));if(m.done)resolve();});w.on('error',reject);w.on('exit',c=>{if(c)reject(new Error(`worker exit ${c}`));});});
  return w;
}
const args=db=>({gymSeasonId:1,roundNumber:1,mapId:1,memberId:1,ticketsUsed:1,pointsScored:1,seasonTemplate:db.prepare('SELECT * FROM season_templates WHERE id=1').get(),nowMs:Date.now()});
test('file connections explicitly use WAL, FK, 5s wait and FULL durability',()=>{
  const f=fixture();try {
    for(const [key,value] of Object.entries({journal_mode:'wal',foreign_keys:1,busy_timeout:5000,synchronous:2})) assert.equal(f.db.pragma(key,{simple:true}),value);
    assert.throws(()=>f.db.exec('INSERT INTO members(gym_season_id,name) VALUES (999,\'invalid\')'),/FOREIGN KEY/);
  } finally {f.close();}
});
test('WAL reader proceeds during writer lock; writer waits then succeeds; timeout is bounded',async()=>{
  const f=fixture();let w;
  try {
    w=worker(f.filename,'hold',250);await once(w,'message');w.postMessage('go');await once(w,'message');
    const start=performance.now();assert.equal(f.db.prepare('SELECT count(*) n FROM members').get().n,100);
    const readMs=performance.now()-start;
    engine.createEntry(f.db,args(f.db));
    assert.ok(performance.now()-start>=150);await w.done;
    await w.terminate();
    w=worker(f.filename,'hold',300);await once(w,'message');w.postMessage('go');await once(w,'message');
    f.db.pragma('busy_timeout=50');
    const t=performance.now();assert.throws(()=>engine.createEntry(f.db,args(f.db)),{code:'SQLITE_BUSY'});
    assert.ok(performance.now()-t>=40);await w.done;
    assert.equal(f.db.prepare('SELECT count(*) n FROM entries').get().n,1);
    console.log(JSON.stringify({wal_read_during_lock_ms:readMs,expected_timeout_errors:1}));
  } finally {if(w)await w.terminate();f.close();}
});
test('3 independent writer connections + snapshot reader: no lost updates or busy errors',async()=>{
  const f=fixture();const workers=[];
  try {
    for(const mode of ['write','write','write','read']) {const w=worker(f.filename,mode);workers.push(w);await once(w,'message');}
    const start=performance.now();workers.forEach(w=>w.postMessage('go'));await Promise.all(workers.map(w=>w.done));
    assert.equal(f.db.prepare('SELECT count(*) n FROM entries').get().n,300);
    assert.equal(f.db.prepare('SELECT current_points n FROM gym_round_map_progress').get().n,300);
    assert.equal(f.db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
    console.log(JSON.stringify({concurrent_db_writes:300,snapshot_reads:100,errors:0,elapsed_ms:performance.now()-start}));
  } finally {await Promise.all(workers.map(w=>w.terminate()));f.close();}
});
test('create/edit/delete roll back entries and progress when round-chain update fails',()=>{
  const f=fixture();try {
    const id=engine.createEntry(f.db,args(f.db)).entryId;
    for(const mutate of [()=>engine.createEntry(f.db,args(f.db)),()=>engine.editEntry(f.db,{entryId:id,ticketsUsed:1,pointsScored:2,seasonTemplate:args(f.db).seasonTemplate,nowMs:Date.now()}),()=>engine.deleteEntry(f.db,{entryId:id})]) {
      const before=f.db.serialize();
      f.db.exec("CREATE TEMP TRIGGER fail_chain BEFORE INSERT ON gym_round_status BEGIN SELECT RAISE(ABORT,'fixture rollback'); END");
      assert.throws(mutate,/fixture rollback/);
      f.db.exec('DROP TRIGGER fail_chain');
      assert.deepEqual(f.db.serialize(),before);
    }
  } finally {f.close();}
});
test('one HTTP Node instance: 80 authenticated log writes mixed with 40 dashboard reads, concurrency 10',async()=>{
  const f=fixture();let app,server;
  try {
    await require('../auth/migrate').migrateCredentials(f.db,{env:{MASTER_ADMIN_CODE:'fixture-master-password'},backupPath:path.join(path.dirname(f.filename),'auth-backup.db')});
    app=require('../server').createApp(f.db,{env:{SESSION_SECRETS:'s'.repeat(32),AUTH_RATE_LIMIT_SECRET:'r'.repeat(32)}});
    server=app.listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}`;
    const login=await fetch(base+'/g/fixture-1/admin/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:'fixture-password-1'})});
    assert.equal(login.status,200);const csrf=(await login.json()).csrf_token;
    const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
    const times=[];let next=0;
    await Promise.all(Array.from({length:10},async()=>{
      while(next<120) {
        const i=next++;const write=i%3!==2;
        const t=performance.now();
        const response=await fetch(base+(write?'/g/fixture-1/admin/entries':`/g/fixture-1/${['overview','leaderboard','log','admin/entries'][Math.floor(i/3)%4]}`),{
          method:write?'POST':'GET',headers:{Origin:base,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},
          ...(write?{body:JSON.stringify({member_id:1,map_id:1,tickets_used:1,points_scored:1})}:{})});
        const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));times.push(performance.now()-t);
      }
    }));
    assert.equal(f.db.prepare('SELECT count(*) n FROM entries').get().n,80);
    assert.equal(f.db.prepare('SELECT current_points n FROM gym_round_map_progress').get().n,80);
    times.sort((a,b)=>a-b);console.log(JSON.stringify({http_requests:120,concurrency:10,errors:0,p50_ms:times[60],p95_ms:times[114],p99_ms:times[118]}));
  } finally {if(app)app.locals.auth.close();if(server)await new Promise(r=>server.close(r));f.close();}
});


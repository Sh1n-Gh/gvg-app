// Isolated synthetic database only; never accepts a production DB path.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {performance} = require('node:perf_hooks');
const {seed,queries} = require('../test/p18-fixture');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'gvg-p18-bench-'));
const db = new Database(path.join(dir,'fixture.db'));
const indexSql = fs.readFileSync(path.join(__dirname,'../db/migrations/004-entry-query-indexes.sql'),'utf8');
const candidates = [...indexSql.matchAll(/CREATE INDEX (\w+) ON entries\([^;]+\);/g)].map(m=>[m[1],m[0]]);
assert.equal(candidates.length,2);
function measure(fn,n=25) {
  for(let i=0;i<3;i++) fn();
  const times=[];
  for(let i=0;i<n;i++){const t=performance.now();fn();times.push(performance.now()-t);}
  times.sort((a,b)=>a-b);
  return {p50_ms:+times[Math.floor(n*.5)].toFixed(3),p95_ms:+times[Math.floor(n*.95)].toFixed(3)};
}
try {
  db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL');
  db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations/001-core.sql'),'utf8'));
  seed(db,10,10000,5);
  db.exec('ANALYZE');
  const workload=queries();
  const baseline=workload.map(q=>db.prepare(q.sql).all(1));
  function snapshot(label) {
    const queries=workload.map((q,i)=>{
      const statement=db.prepare(q.sql);
      assert.deepEqual(statement.all(1),baseline[i]);
      return {name:q.name,sql:q.sql,plan:db.prepare('EXPLAIN QUERY PLAN '+q.sql).all(1).map(r=>r.detail),...measure(()=>statement.all(1))};
    });
    const insert=db.prepare("INSERT INTO entries(gym_season_id,round_number,season_template_map_id,member_id,tickets_used,points_scored) VALUES (1,1,1,1,1,1)");
    // Rolled back to keep each stage's query rows identical. Measures index maintenance,
    // excludes fsync/commit and is not an HTTP throughput estimate.
    const write=measure(()=>{db.exec('BEGIN IMMEDIATE');try{for(let i=0;i<1000;i++)insert.run();}finally{db.exec('ROLLBACK');}},15);
    return {label,bytes:db.pragma('page_count',{simple:true})*db.pragma('page_size',{simple:true}),queries,write_1000_rollback:write};
  }
  const stages=[snapshot('baseline')];
  for(const [name,sql] of candidates){db.exec(sql);db.exec('ANALYZE');stages.push(snapshot(name));}
  console.log(JSON.stringify({node:process.version,sqlite:db.prepare('SELECT sqlite_version() v').get().v,seasons:10,maps:5,members:1000,entries:100000,stages},null,2));
} finally {db.close();fs.rmSync(dir,{recursive:true,force:true});}

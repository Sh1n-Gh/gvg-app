const { createHmac } = require('node:crypto');
// Reservations are atomic and made before hashing, including concurrent requests.
function createLimiter(db,secret,now=Date.now) {
  const windowMs=15*60e3;
  const key=value=>createHmac('sha256',secret).update(value).digest();
  function reserve(namespace,ip,principal) {
    const buckets=[{hash:key(`${namespace}:ip:${ip}`),limit:namespace==='master'?5:10},
      {hash:key(`${namespace}:principal:${principal}`),limit:5}];
    return db.transaction(()=>{
      const t=now();
      const rows=buckets.map(b=>{
        let r=db.prepare('SELECT * FROM auth_rate_limits WHERE bucket_hash=?').get(b.hash);
        if (!r || (r.updated_at<t-24*3600e3)) r={window_started_at:t,attempt_count:0,blocked_until:0,block_count:0};
        if (r.window_started_at+windowMs<=t && r.blocked_until<=t) r={...r,window_started_at:t,attempt_count:0};
        return {...b,...r};
      });
      const blocked=rows.find(r=>r.blocked_until>t || r.attempt_count>=r.limit);
      if(blocked) return {retry:Math.max(1,Math.ceil(((blocked.blocked_until>t?blocked.blocked_until:blocked.window_started_at+windowMs)-t)/1000))};
      for(const r of rows) db.prepare(`INSERT INTO auth_rate_limits(bucket_hash,window_started_at,attempt_count,blocked_until,updated_at,block_count)
        VALUES (?,?,?,?,?,?) ON CONFLICT(bucket_hash) DO UPDATE SET window_started_at=excluded.window_started_at,
        attempt_count=excluded.attempt_count,blocked_until=excluded.blocked_until,updated_at=excluded.updated_at,block_count=excluded.block_count`)
        .run(r.hash,r.window_started_at,r.attempt_count+1,r.blocked_until,t,r.block_count);
      return {buckets:rows};
    }).immediate();
  }
  function finish(ticket,success) {
    db.transaction(()=>{
      ticket.buckets.forEach((r,i)=>{
        if(success) {
          if(i===1) db.prepare('DELETE FROM auth_rate_limits WHERE bucket_hash=?').run(r.hash);
          else db.prepare('UPDATE auth_rate_limits SET attempt_count=max(0,attempt_count-1) WHERE bucket_hash=?').run(r.hash);
        } else {
          // Repeat blocks escalate 15 -> 30 -> 60 minutes while the bucket is retained.
          const duration=windowMs*2**Math.min(2,r.block_count);
          db.prepare('UPDATE auth_rate_limits SET blocked_until=?,updated_at=?,block_count=min(3,block_count+1) WHERE bucket_hash=? AND attempt_count>=? AND coalesce(blocked_until,0)<=?')
            .run(now()+duration,now(),r.hash,r.limit,now());
        }
      });
    }).immediate();
  }
  return {reserve,finish,cleanup:()=>db.prepare('DELETE FROM auth_rate_limits WHERE updated_at<?').run(now()-24*3600e3)};
}
module.exports={createLimiter};

const session = require('./session-library');
const { createHash } = require('node:crypto');
const TTL = { master: { idle: 30*60e3, absolute: 8*3600e3 }, gym: { idle: 8*3600e3, absolute: 24*3600e3 } };
const digest = sid => createHash('sha256').update(sid).digest();
class SQLiteSessionStore extends session.Store {
  constructor(db, namespace, now = Date.now) { super(); this.db=db; this.namespace=namespace; this.now=now; }
  get(sid, cb) {
    try {
      const row=this.db.prepare('SELECT * FROM auth_sessions WHERE sid_hash=? AND namespace=?').get(digest(sid),this.namespace);
      if (!row) return cb(null,null);
      const p=this.db.prepare('SELECT role,gym_id,session_version,disabled_at FROM auth_principals WHERE id=?').get(row.principal_id);
      if (row.revoked_at || row.idle_expires_at<=this.now() || row.absolute_expires_at<=this.now()
          || !p || p.disabled_at || p.role!==this.namespace || p.gym_id!==row.gym_id || p.session_version!==row.principal_session_version) {
        this.destroy(sid,()=>{}); return cb(null,null);
      }
      const data=JSON.parse(row.session_json);
      data.auth={...data.auth,principalId:row.principal_id,role:row.namespace,gymId:row.gym_id,
        version:row.principal_session_version,createdAt:row.created_at,absoluteAt:row.absolute_expires_at};
      cb(null,data);
    } catch { cb(new Error('AUTH_STORE: read failed')); }
  }
  set(sid, data, cb=()=>{}) {
    try {
      const a=data.auth;
      if (!a || a.role!==this.namespace) return cb();
      const now=this.now();
      const p=this.db.prepare('SELECT session_version,disabled_at FROM auth_principals WHERE id=? AND role=? AND gym_id IS ?').get(a.principalId,a.role,a.gymId);
      if (!p || p.disabled_at || p.session_version!==a.version || a.absoluteAt<=now) return cb();
      const safe={cookie:data.cookie,auth:{principalId:a.principalId,role:a.role,gymId:a.gymId,version:a.version,
        createdAt:a.createdAt,absoluteAt:a.absoluteAt,authenticatedAt:a.authenticatedAt,csrf:a.csrf}};
      this.db.prepare(`INSERT INTO auth_sessions(sid_hash,namespace,principal_id,principal_session_version,gym_id,session_json,
        created_at,last_seen_at,idle_expires_at,absolute_expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(sid_hash) DO UPDATE SET session_json=excluded.session_json,last_seen_at=excluded.last_seen_at,
        idle_expires_at=excluded.idle_expires_at WHERE auth_sessions.revoked_at IS NULL`).run(
        digest(sid),this.namespace,a.principalId,a.version,a.gymId,JSON.stringify(safe),a.createdAt,now,
        Math.min(now+TTL[this.namespace].idle,a.absoluteAt),a.absoluteAt);
      cb();
    } catch { cb(new Error('AUTH_STORE: write failed')); }
  }
  touch(sid,data,cb=()=>{}) {
    try {
      const now=this.now();
      this.db.prepare(`UPDATE auth_sessions SET last_seen_at=?,idle_expires_at=min(?,absolute_expires_at)
        WHERE sid_hash=? AND namespace=? AND revoked_at IS NULL AND idle_expires_at>? AND absolute_expires_at>?
        AND last_seen_at<=?`).run(now,now+TTL[this.namespace].idle,digest(sid),this.namespace,now,now,now-5*60e3);
      cb();
    } catch { cb(new Error('AUTH_STORE: touch failed')); }
  }
  destroy(sid,cb=()=>{}) {
    try {
      // Tombstone until expiry prevents an in-flight response resurrecting a logged-out SID.
      this.db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE sid_hash=? AND namespace=?').run(this.now(),digest(sid),this.namespace); cb();
    } catch { cb(new Error('AUTH_STORE: destroy failed')); }
  }
  clearExpired() {
    this.db.prepare('DELETE FROM auth_sessions WHERE idle_expires_at<=? OR absolute_expires_at<=?').run(this.now(),this.now());
  }
}
module.exports={SQLiteSessionStore,TTL,digest};

const express=require('express');
const session=require('./session-library');
const crypto=require('node:crypto');
const { SQLiteSessionStore,TTL }=require('./session-store');
const { createLimiter }=require('./rate-limit');
const { hashPassword,verifyPassword,validatePassword }=require('./password');
const random=()=>crypto.randomBytes(32).toString('base64url');
const constantEqual=(a,b)=>typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b)
  && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const callback=fn=>new Promise((resolve,reject)=>fn(err=>err?reject(err):resolve()));
const fail=(res,status)=>res.status(status).json({error:status===401?'Thông tin xác thực không hợp lệ':'Yêu cầu không được phép'});
function createAuth(db,env=process.env,{now=Date.now}={}) {
  const production=env.NODE_ENV==='production';
  const configuredKeys=(env.SESSION_SECRETS || '').split(',').map(s=>s.trim()).filter(Boolean);
  const keys=configuredKeys.length ? configuredKeys : [random()];
  const limiter=createLimiter(db,env.AUTH_RATE_LIMIT_SECRET || random(),now);
  const dummy=hashPassword(random());
  const metrics={cleanupFailures:0};
  const stores=[];
  function originAllowed(req) {
    const expected=env.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
    const origin=req.get('origin');
    if(origin) return origin===expected;
    try {
      const referer=new URL(req.get('referer'));
      return referer.origin===expected && (!production || referer.protocol==='https:');
    } catch { return false; }
  }
  function origin(req,res,next) { if(!originAllowed(req)) return fail(res,403); next(); }
  function namespace(role) {
    const router=require('../security/lifecycle').trackedRouter(express.Router({mergeParams:true}));
    router.param('id', require('../security/validation').idParam);
    const name=`${production?'__Host-':''}gvg_${role}_session`;
    const cookie={httpOnly:true,secure:production,sameSite:'lax',path:'/',priority:'high'};
    const store=new SQLiteSessionStore(db,role,now); stores.push(store); store.clearExpired();
    const principal= gymId=> db.prepare(`SELECT id,role,gym_id,password_hash,password_version,session_version,must_rotate,disabled_at
      FROM auth_principals WHERE role=? AND gym_id IS ?`).get(role,gymId??null);
    router.use((req,res,next)=>{
      res.set('Cache-Control','no-store');
      if(role==='gym') {
        req.gym=db.prepare('SELECT id,name,slug FROM gyms WHERE slug=? AND deleted_at IS NULL').get(req.params.slug);
        if(!req.gym) return res.status(404).json({error:'Không tìm thấy Gym'});
      }
      next();
    });
    router.use(session({name,secret:keys,store,resave:false,saveUninitialized:false,rolling:true,
      genid:random,cookie:{...cookie,maxAge:TTL[role].idle}}));
    router.use((req,res,next)=>{
      if(!req.session.auth && req.headers.cookie?.split(';').some(v=>v.trim().startsWith(name+'='))) res.clearCookie(name,cookie);
      next();
    });
    function sessionPrincipal(req,res) {
      const a=req.session?.auth;
      if(!a) return null;
      const p=principal(a.gymId);
      if(!p || p.disabled_at || p.id!==a.principalId || p.session_version!==a.version || a.role!==role || a.absoluteAt<=now()) {
        req.session.destroy(()=>{}); res.clearCookie(name,cookie); return null;
      }
      return p;
    }
    async function credential(req,res,password,p) {
      if(typeof password!=='string' || !password.length || Buffer.byteLength(password)>4096 || !password.isWellFormed()) {
        fail(res,400); return null;
      }
      const ip=require('../security/request-limits').clientIp(req);
      const ticket=limiter.reserve(role,ip,req.gym?.id ?? 'master');
      if(ticket.retry) {res.set('Retry-After',String(ticket.retry)); res.status(429).json({error:'Thử lại sau'}); return null;}
      let valid=false;
      try {valid=await verifyPassword(password,p && !p.disabled_at?p.password_hash:await dummy) && !!p && !p.disabled_at;}
      finally {limiter.finish(ticket,valid);}
      // Credential/reset races must never authenticate using an old version.
      const current=p && principal(p.gym_id);
      if(!valid || !current || current.disabled_at || current.password_version!==p.password_version || current.session_version!==p.session_version) {
        fail(res,401); return null;
      }
      return current;
    }
    async function issue(req,p) {
      await callback(cb=>req.session.regenerate(cb));
      req.session.auth={principalId:p.id,role,gymId:p.gym_id,version:p.session_version,csrf:random(),
        createdAt:now(),authenticatedAt:now(),absoluteAt:now()+TTL[role].absolute};
      req.session.cookie.maxAge=TTL[role].idle;
      await callback(cb=>req.session.save(cb));
    }
    function metadata(req,p) {
      return {ok:true,role,csrf_token:req.session.auth.csrf,
        expires_at:Math.min(now()+TTL[role].idle,req.session.auth.absoluteAt),must_rotate:!!p.must_rotate,
        ...(role==='gym'?{gym:{id:req.gym.id,name:req.gym.name,slug:req.gym.slug}}:{})};
    }
    function csrf(req,res) {
      return originAllowed(req) && constantEqual(req.get('x-csrf-token'),req.session?.auth?.csrf);
    }
    async function requireAdmin(req,res,next) {
      if(/^\/verify\/?$/i.test(req.path)) return res.sendStatus(404);
      const p=sessionPrincipal(req,res);
      if(p) {
        if(role==='gym' && p.gym_id!==req.gym.id) return fail(res,403);
        if(!['GET','HEAD','OPTIONS'].includes(req.method) && !csrf(req,res)) return fail(res,403);
        req.principal=p;
        req.session.cookie.maxAge=Math.min(TTL[role].idle,req.session.auth.absoluteAt-now());
        return next();
      }
      return fail(res,401);
    }
    router.post('/auth/login',origin,async(req,res)=>{
      if(production && !req.secure) return fail(res,403);
      const p=await credential(req,res,req.body?.password,principal(req.gym?.id));
      if(!p) return;
      await issue(req,p); res.json(metadata(req,p));
    });
    router.get('/auth/session',requireAdmin,(req,res)=>res.json(metadata(req,req.principal)));
    router.post('/auth/logout',origin,async(req,res)=>{
      const p=sessionPrincipal(req,res);
      if(p && ((role==='gym' && p.gym_id!==req.gym.id) || !csrf(req,res))) return fail(res,403);
      await callback(cb=>req.session.destroy(cb)); res.clearCookie(name,cookie); res.sendStatus(204);
    });
    router.post('/auth/change-password',requireAdmin,async(req,res)=>{
      try {validatePassword(req.body?.new_password);} catch {return fail(res,400);}
      const p=await credential(req,res,req.body?.current_password,req.principal);
      if(!p) return;
      const hash=await hashPassword(req.body.new_password);
      const changed=rotate(p,hash,0);
      if(!changed) return fail(res,401);
      await issue(req,principal(p.gym_id)); res.json(metadata(req,principal(p.gym_id)));
    });
    if(role==='master') router.post('/gyms/:id/admin-password/reset',requireAdmin,async(req,res)=>{
      let p=req.principal;
      if(now()-req.session.auth.authenticatedAt>10*60e3) {
        p=await credential(req,res,req.body?.current_password,p); if(!p) return;
      }
      const target=db.prepare("SELECT id,role,gym_id,password_version,session_version FROM auth_principals WHERE role='gym' AND gym_id=?").get(req.params.id);
      if(!target) return res.sendStatus(404);
      const temporary=random(); const hash=await hashPassword(temporary);
      const currentMaster=principal(null);
      if(!currentMaster || currentMaster.disabled_at || currentMaster.session_version!==p.session_version) return fail(res,401);
      if(!rotate(target,hash,1)) return fail(res,409);
      res.json({ok:true,temporary_password:temporary,must_rotate:true});
    });
    router.use((req,res,next)=>{
      // Keep HTML redirect public; all business APIs pass the same guard, including upload.
      if(role==='gym' && req.path==='/' && req.method==='GET') return next();
      return requireAdmin(req,res,next);
    });
    return router;
  }
  function rotate(p,hash,mustRotate) {
    return db.transaction(()=>{
      const result=db.prepare(`UPDATE auth_principals SET password_hash=?,password_version=password_version+1,
        session_version=session_version+1,must_rotate=?,password_changed_at=datetime('now')
        WHERE id=? AND password_version=? AND session_version=? AND disabled_at IS NULL`).run(hash,mustRotate,p.id,p.password_version,p.session_version);
      if(result.changes) db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE principal_id=?').run(now(),p.id);
      return !!result.changes;
    }).immediate();
  }
  const master=namespace('master'),gym=namespace('gym');
  limiter.cleanup();
  const timer=setInterval(()=>{try {stores.forEach(s=>s.clearExpired());limiter.cleanup();} catch { metrics.cleanupFailures++; }},5*60e3);
  timer.unref();
  return {master,gym,metrics,close:()=>clearInterval(timer)};
}
module.exports={createAuth};

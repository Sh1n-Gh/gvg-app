const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../db');
const { createApp } = require('../server');
const { migrateCredentials } = require('../auth/migrate');
const { season, url } = require('../security/validation');
const { configureProxy, clientIp } = require('../security/request-limits');
const express = require('express');

const validSeason = () => ({ name: 'Season', maps: [{ name: 'Map' }], rounds: [{ round_number: 1, max_score: 100 }], ticket_config: { battle_start_at: '2026-01-01T00:00:00Z', day1_amount: 12, daily_amount: 3, regen_days: 6 } });
async function fixture(trust = '') {
  const db = createDb(':memory:');
  db.prepare("INSERT INTO season_templates(name,is_active,last_defined_round_number,repeat_max_score,battle_start_at,ticket_day1_amount,ticket_daily_amount,ticket_regen_days) VALUES ('Test',1,1,100,'2026-01-01T00:00:00Z',12,3,6)").run();
  db.prepare("INSERT INTO season_template_maps(season_template_id,name,order_index) VALUES (1,'Map',1)").run();
  db.prepare('INSERT INTO season_template_rounds(season_template_id,round_number,max_score,order_index) VALUES (1,1,100,1)').run();
  for (const slug of ['a','b','c']) {
    const g = db.prepare('INSERT INTO gyms(name,slug,admin_code) VALUES (?,?,?)').run(slug,slug,`legacy-${slug}`).lastInsertRowid;
    db.prepare('INSERT INTO gym_seasons(gym_id,season_template_id) VALUES (?,1)').run(g);
    require('../engine').recomputeRoundChain(db, Number(g));
  }
  await migrateCredentials(db, { env: { MASTER_ADMIN_CODE: 'test-master-password' } });
  let time = Date.now();
  const app = createApp(db, { env: { TRUST_PROXY: trust }, now: () => time });
  const server = app.listen(0,'127.0.0.1');
  await new Promise(r => server.once('listening',r));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', body, raw, headers = {}, login } = {}) {
    const r = await fetch(base + path, { method, headers: { Origin: base, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(login ? { Cookie: login.cookie, 'X-CSRF-Token': login.csrf } : {}), ...headers }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, headers: r.headers };
  }
  async function login(role = 'master') {
    const r = await request(role === 'master' ? '/master/auth/login' : `/g/${role}/admin/auth/login`, { method: 'POST', body: { password: role === 'master' ? 'test-master-password' : `legacy-${role}` } });
    assert.equal(r.status,200); return { cookie: r.headers.get('set-cookie').split(';')[0], csrf: r.data.csrf_token };
  }
  return { db, request, login, advance: ms => time += ms, close: async () => { app.locals.auth.close(); await new Promise(r => server.close(r)); db.close(); } };
}

test('strict season numeric, date, collection and URL validation including NaN', () => {
  assert.doesNotThrow(() => season(validSeason()));
  for (const value of [-1, NaN, Infinity, '1', '', null, true, 1.5, 1e20]) {
    const b = validSeason(); b.rounds[0].max_score = value; assert.throws(() => season(b));
    const t = validSeason(); t.ticket_config.regen_days = value; assert.throws(() => season(t));
  }
  for (const date of ['no-date','2026-02-30T00:00:00Z','2026-01-01','2026-01-01T25:00:00Z']) { const b=validSeason(); b.ticket_config.battle_start_at=date; assert.throws(()=>season(b)); }
  for (const badUrl of ['javascript:alert(1)','data:image/svg+xml,x','//evil.test/a','https://u:p@host/a','/a\\b','https://x/"']) assert.throws(()=>url(badUrl,'url'));
  for (const good of ['', '/uploads/map-images/a.png', 'https://example.com/a.png']) assert.doesNotThrow(()=>url(good,'url'));
  const b=validSeason(); b.rounds[0].round_number=100; assert.throws(()=>season(b));
});

test('HTTP validation rejects malformed IDs/input, keeps valid writes, standard status codes', async () => {
  const f=await fixture(); try {
    const master=await f.login(); const gym=await f.login('a');
    assert.equal((await f.request('/master/gyms')).data.code,'UNAUTHENTICATED');
    assert.equal((await f.request('/master/gyms/1/delete',{method:'PATCH',login:{...master,csrf:'bad'},body:{}})).data.code,'FORBIDDEN');
    for (const id of ['0','-1','1.5','NaN','1abc','9007199254740992']) {
      assert.equal((await f.request(`/master/gyms/${id}/delete`,{method:'PATCH',login:master})).status,400);
      assert.equal((await f.request(`/g/a/seasons/${id}/state`)).status,400);
      assert.equal((await f.request(`/master/gyms/${id}/admin-password/reset`,{method:'POST',login:master})).status,400);
    }
    assert.equal((await f.request('/g/a/seasons/999/state')).data.code,'NOT_FOUND');
    for (const name of ['', 'x'.repeat(121), 123, null, {}]) assert.equal((await f.request('/g/a/admin/members/bulk',{method:'POST',login:gym,body:{members:[{name}]}})).status,400);
    assert.equal((await f.request('/g/a/admin/members/bulk',{method:'POST',login:gym,body:{members:[{name:'Valid',avatar_url:'/a.png'},{name:'Other'}]}})).status,200);
    for(const value of [-1, null, 'NaN', '1', 1.2, 1e20]) {
      const r=await f.request('/g/a/admin/entries',{method:'POST',login:gym,body:{member_id:1,map_id:1,tickets_used:1,points_scored:value}});
      assert.equal(r.status,400); assert.equal(r.data.code,'INVALID_REQUEST');
    }
    assert.equal((await f.request('/g/a/admin/entries',{method:'POST',login:gym,body:{member_id:1,map_id:1,tickets_used:1,points_scored:10}})).status,200);
    assert.equal((await f.request('/g/a/admin/members/2',{method:'PATCH',login:gym,body:{name:'Valid'}})).data.code,'CONFLICT');
    assert.equal((await f.request('/g/a/admin/members/1',{method:'PATCH',login:gym,body:{avatar_url:'javascript:alert(1)'}})).status,400);
    assert.equal((await f.request('/g/a/admin/MEMBERS/1/',{method:'PATCH',login:gym,body:{name:123}})).status,400);
    assert.equal((await f.request('/g/a/admin/entries',{method:'POST',login:gym,body:{member_id:999,map_id:1,tickets_used:1,points_scored:10}})).status,404);
    const b=validSeason(); b.maps[0].id=999;
    assert.equal((await f.request('/master/season-templates/1',{method:'PATCH',login:master,body:b})).status,404);
    assert.equal(f.db.prepare('SELECT count(*) n FROM entries').get().n,1);
    for (const mutate of [b=>b.name='x'.repeat(121), b=>b.maps=[null], b=>b.maps[0].image_url='data:text/html,x', b=>b.maps[0].note='x'.repeat(2001), b=>b.rounds[0].round_number=-1, b=>b.ticket_config.day1_amount=-1, b=>b.ticket_config.daily_amount='NaN', b=>b.ticket_config.battle_start_at='bad', b=>b.rounds=Array(101).fill({round_number:1,max_score:1})]) {
      const body=validSeason(); mutate(body);
      assert.equal((await f.request('/master/season-templates/',{method:'POST',login:master,body})).status,400);
    }
    assert.equal((await f.request('/master/gyms',{method:'POST',login:master,body:{name:'Valid',slug:'x'.repeat(101)}})).status,400);
    assert.equal((await f.request('/g/a/admin/members/bulk',{method:'POST',login:gym,body:{members:Array(501).fill({name:'x'})}})).status,400);
    assert.equal((await f.request('/g/a/admin/entries',{method:'POST',login:gym,body:{member_id:1,map_id:1,tickets_used:-1,points_scored:1}})).status,400);
    assert.equal(f.db.prepare('SELECT count(*) n FROM season_templates').get().n,1);
  } finally { await f.close(); }
});

test('JSON/raw upload limits and unsupported forms, malformed JSON, valid raw format', async () => {
  const f=await fixture(); try {
    const master=await f.login();
    for(const [path,size] of [['/master/auth/login',9*1024],['/master/gyms',129*1024]]) {
      const r=await f.request(path,{method:'POST',body:{x:'x'.repeat(size)},login:master}); assert.equal(r.status,413); assert.equal(r.data.code,'PAYLOAD_TOO_LARGE');
    }
    assert.equal((await f.request('/master/gyms',{method:'POST',raw:'{',headers:{'Content-Type':'application/json'},login:master})).status,400);
    for(const type of ['application/x-www-form-urlencoded','multipart/form-data; boundary=test']) {
      assert.equal((await f.request('/master/gyms',{method:'POST',raw:'x=1',headers:{'Content-Type':type}})).status,400);
      assert.equal((await f.request('/master/gyms',{method:'POST',raw:'x'.repeat(9000),headers:{'Content-Type':type}})).status,413);
    }
    assert.equal((await f.request('/master/map-images',{method:'POST',raw:Buffer.alloc(5*1024*1024+1),headers:{'Content-Type':'image/png'},login:master})).status,413);
    assert.equal((await f.request('/master/map-images',{method:'POST',raw:Buffer.from('fake'),headers:{'Content-Type':'image/png'},login:master})).status,400);
    assert.equal((await f.request('/master/gyms',{method:'POST',body:[],login:master})).status,400);
  } finally { await f.close(); }
});

test('brute force principal across IPs, IP across gyms, proxy identity and spoof prevention', async () => {
  const f=await fixture('127.0.0.1'); try {
    for(let i=0;i<5;i++) assert.equal((await f.request('/g/a/admin/auth/login',{method:'POST',body:{password:'wrong'},headers:{'X-Forwarded-For':`192.0.2.${i+1}`}})).status,401);
    const blocked=await f.request('/g/a/admin/auth/login',{method:'POST',body:{password:'legacy-a'},headers:{'X-Forwarded-For':'192.0.2.99'}});
    assert.equal(blocked.status,429); assert.ok(Number(blocked.headers.get('retry-after'))>0);
    assert.equal((await f.request('/g/b/admin/auth/login',{method:'POST',body:{password:'legacy-b'},headers:{'X-Forwarded-For':'192.0.2.99'}})).status,200);
    f.advance(16*60e3);
    for(const slug of ['a','b']) for(let i=0;i<5;i++) assert.equal((await f.request(`/g/${slug}/admin/auth/login`,{method:'POST',body:{password:'wrong'},headers:{'X-Forwarded-For':'198.51.100.1'}})).status,401);
    assert.equal((await f.request('/g/c/admin/auth/login',{method:'POST',body:{password:'legacy-c'},headers:{'X-Forwarded-For':'198.51.100.1'}})).status,429);
  } finally { await f.close(); }
  const direct=await fixture(); try {
    for(let i=0;i<20;i++) assert.equal((await direct.request('/master/verify',{headers:{'X-Forwarded-For':`192.0.2.${i}`}})).status,404);
    assert.equal((await direct.request('/master/verify',{headers:{'X-Forwarded-For':'203.0.113.1'}})).status,429);
  } finally { await direct.close(); }
});

test('read/mutation/upload budgets expire and trusted clients remain independent', async () => {
  const f=await fixture('127.0.0.1'); try {
    for(const [path,method,max] of [['/g/a/state','GET',240],['/master/gyms','POST',120],['/master/map-images','POST',10]]) {
      for(let i=0;i<max;i++) assert.notEqual((await f.request(path,{method,headers:{'X-Forwarded-For':'192.0.2.1'}})).status,429);
      assert.equal((await f.request(path,{method,headers:{'X-Forwarded-For':'192.0.2.1'}})).status,429);
      assert.notEqual((await f.request(path,{method,headers:{'X-Forwarded-For':'192.0.2.2'}})).status,429);
      f.advance(61000);
      assert.notEqual((await f.request(path,{method,headers:{'X-Forwarded-For':'192.0.2.1'}})).status,429);
    }
    assert.equal((await f.request('/g/a/state')).status,200);
  } finally { await f.close(); }
});

test('trust proxy rejects blanket trust; IPv6 /64 addresses share a budget identity', () => {
  for(const value of ['true','1','0.0.0.0/0','::/0','garbage']) assert.throws(()=>configureProxy(express(),value));
  assert.doesNotThrow(()=>configureProxy(express(),'127.0.0.1,::1,10.0.0.0/24'));
  assert.equal(clientIp({ip:'2001:db8:abcd:1::1234'}),clientIp({ip:'2001:db8:abcd:1::ffff'}));
});

const { suiteTest } = require('./visual-suite-mode');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {waitForScreenshotStability}=require('./screenshot-stability');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const attack='\"><img src=x onerror="window.__xss=1"><svg onload="window.__xss=1">&\'';
function fixture(name='Alice',url='/assets/pokemon-types/fire.svg') {
 const map={id:1,name,image_url:url,type_weakness:'fire',status:'active',round_progress_pct:45,current_points:45};
 const member={id:1,name,avatar_url:url,total_points:45,tickets_granted:10,tickets_used:2,tickets_remaining:8,tickets_future:3,average_points_per_ticket:22.5};
 return {state:{gym:{name},season:{name},summary:{combined_score:45,total_tickets_remaining:8},active_round:{round_number:1,max_score:100},maps:[map]},overview:{maps:[map],members:[member],rounds:[1],score_cells:[{member_id:1,map_id:1,total_points:45}],ticket_cells:[{round_number:1,map_id:1,tickets:[1,1]}]},leaderboard:[member],log:[{member_id:1,season_template_map_id:1,member_name:name,map_name:name,member_avatar:url,map_avatar:url,round_number:1,tickets_used:2,points_scored:45,created_at:'2026-01-01 00:00:00'}],seasons:[{season_name:name,is_active:1,combined_score:45}]};
}
async function setup(browser,data,source=read('public/dashboard.js'),freezePolling=false) {
 const page=await browser.newPage();
 const pollRequests={state:0,overview:0};
 page.__pollRequests=pollRequests;
 if(freezePolling)await page.addInitScript(()=>{
  const original=window.setInterval;
  window.__pollProbe={blocked:[],callbacks:0};
  window.setInterval=function(callback,delay,...args){
   if(delay===15000 && callback.name==='loadState'){
    window.__pollProbe.blocked.push({delay,name:callback.name});
    return -1;
   }
   return original.call(window,callback,delay,...args);
  };
 });
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/g/test')return route.fulfill({contentType:'text/html',body:read('public/dashboard.html').replace(/<script src="\/(auth-client|admin)\.js"><\/script>/g,'')});
  if(url.pathname==='/dashboard.js')return route.fulfill({contentType:'text/javascript',body:source});
  const key=url.pathname.split('/').pop();
  if(Object.hasOwn(pollRequests,key))pollRequests[key]++;
  if(Object.hasOwn(data,key))return route.fulfill({status:data[key]?.error?400:200,json:data[key]});
  if(url.origin==='http://dashboard.test' && fs.existsSync(path.join(root,'public',url.pathname)))return route.fulfill({path:path.join(root,'public',url.pathname)});
  return route.abort();
 });
 await page.addInitScript(()=>{Date.now=()=>Date.parse('2026-09-07T00:00:00Z');window.__xss=0;});
 await page.goto('http://dashboard.test/g/test');
 await page.waitForFunction(()=>document.querySelector('#score-overview').childElementCount>0);
 return page;
}
test('P06 Dashboard XSS and responsive regression',{timeout:120000},async t=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||(process.platform==='win32'?'msedge':undefined)});
 try {
 await suiteTest(t, 'escape roundtrips text and quoted attributes; URL allowlist',async()=>{
  const page=await setup(browser,fixture());
  const result=await page.evaluate(payload=>{
   const div=document.createElement('div');div.innerHTML='<span title="'+dashboardEscape(payload)+'">'+dashboardEscape(payload)+'</span>';
   const bad=['javascript:alert(1)','JaVaScRiPt:alert(1)','java\nscript:alert(1)','data:text/html,<script>alert(1)</script>','data:image/svg+xml,<svg onload=alert(1)>','data:image/png;base64,AAAA','blob:https://example.com/id','file:///x','https://x/" onerror="alert(1)','//user:pass@example.com/a','\\\\evil.test/x','https://[invalid'];
   return {text:div.textContent,title:div.firstChild.title,count:div.childElementCount,bad:bad.map(dashboardImageUrl),good:['/uploads/a.png','https://example.com/a.png?x=1&y=2','http://example.com/a.jpg'].map(dashboardImageUrl),types:['__proto__','constructor','toString'].map(normalizePokemonType)};
  },attack);
  assert.equal(result.text,attack);assert.equal(result.title,attack);assert.equal(result.count,1);assert.ok(result.bad.every(x=>x===''));assert.ok(result.good.every(Boolean));assert.deepEqual(result.types,[null,null,null]);await page.close();
 });
 await suiteTest(t, 'all public renderers and filters treat API payloads as data',async()=>{
  for(const url of ['javascript:alert(1)','data:image/svg+xml,<svg onload="window.__xss=1">','x" onerror="window.__xss=1']) {
   const data=fixture(attack,url);data.state.maps[0].round_progress_pct=attack;data.state.maps[0].type_weakness=attack;
   data.overview.rounds=[attack];data.overview.ticket_cells=[{round_number:attack,map_id:1,tickets:[attack]}];
   data.log[0].round_number=attack;data.log[0].tickets_used=attack;data.log[0].member_id=attack;
   const page=await setup(browser,data);
   await page.evaluate(async()=>{await loadLeaderboard();await loadLog();await loadSeasons();});
   assert.equal(await page.locator('.map-card-name').textContent(),attack);
   assert.equal(await page.locator('.overview-member-name').textContent(),attack);
   assert.equal(await page.locator('.overview-ticket-cell').textContent(),attack);
   assert.equal(await page.locator('.leaderboard-name').textContent(),attack);
   assert.equal(await page.locator('.log-member-name').textContent(),attack);
   assert.equal(await page.locator('#public-log-filter-member option').last().getAttribute('value'),attack);
   assert.equal(await page.locator('#seasons-list > div > span').first().textContent(),attack+' Đang chơi');
   assert.equal(await page.evaluate(()=>window.__xss),0);
   assert.equal(await page.locator('svg,script:not([src]),[onerror],[onload]').count(),0);
   assert.equal(await page.locator('img').count(),0);
   await page.close();
  }
 });
 await suiteTest(t, 'API error remains literal text',async()=>{
  const data=fixture();data.overview={error:attack};const page=await setup(browser,data);
  assert.equal(await page.locator('#score-overview').textContent(),'⚠️ Không tải được overview: '+attack);
  assert.equal(await page.locator('#ticket-overview img').count(),0);
  await page.evaluate(async payload=>{window.fetch=async()=>({ok:false,json:async()=>({error:payload})});await loadState();},attack);
  assert.equal(await page.locator('#season-name').textContent(),attack);assert.equal(await page.evaluate(()=>window.__xss),0);await page.close();
 });
 const baseline=path.join(root,'tmp/p06/dashboard-before.js');
 await suiteTest(t, 'before/after pixel equality across four public tabs at 390/768/1440',{skip:!fs.existsSync(baseline) && 'Capture tmp/p06/dashboard-before.js before editing to compare pixels'},async()=>{
  const freezePolling=process.env.VISUAL_FREEZE_DASHBOARD_POLLING==='1';
  const before=await setup(browser,fixture(),fs.readFileSync(baseline,'utf8'),freezePolling);
  const after=await setup(browser,fixture(),read('public/dashboard.js'),freezePolling);
  for(const width of [390,768,1440])for(const tab of ['dashboard','leaderboard','log','seasons']) {
   if(process.env.VISUAL_CAPTURE_CASE && process.env.VISUAL_CAPTURE_CASE!==`${width}/${tab}`)continue;
   const shots=[];
   for(const [label,page] of [['before',before],['after',after]]) {
    await page.setViewportSize({width,height:900});await page.locator(`[data-tab="${tab}"]`).click();
    await page.evaluate(async()=>{await loadLeaderboard();await loadLog();await loadSeasons();await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));});
    await waitForScreenshotStability(page);
    if(freezePolling){
     const probe=await page.evaluate(()=>window.__pollProbe);
     assert.deepEqual(probe.blocked,[{delay:15000,name:'loadState'}]);
     assert.deepEqual(page.__pollRequests,{state:1,overview:1});
     console.log('POLLING_FROZEN '+JSON.stringify({label,probe,requests:page.__pollRequests}));
    }
    await require('./bbox-diagnostic').captureBbox(page,label,`${width}/${tab}`);
    shots.push(await page.screenshot({path:path.join(root,`tmp/p06/${label}-${width}-${tab}.png`),fullPage:true,animations:'disabled'}));
   }
   assert.ok(shots[0].equals(shots[1]),`pixels changed: ${width} ${tab}`);
  }
  await before.close();await after.close();
 });
 } finally {await browser.close();}
});

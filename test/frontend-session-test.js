const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createDb } = require('../db');
const { createApp } = require('../server');
const { migrateCredentials } = require('../auth/migrate');
const masterPassword = 'browser master fixture';

test('P05 browser session cutover (legacy disabled)', { timeout: 120000 }, async t => {
  const db = createDb(':memory:');
  for (const slug of ['a','b']) db.prepare('INSERT INTO gyms(name,slug,admin_code) VALUES (?,?,?)').run(slug,slug,'gym-password-'+slug);
  db.exec(`INSERT INTO season_templates(id,name,is_active,last_defined_round_number,battle_start_at,ticket_day1_amount,ticket_daily_amount,ticket_regen_days)
    VALUES (1,'Browser season',1,1,'2026-01-01',10,1,1);
    INSERT INTO season_template_maps(id,season_template_id,name,order_index) VALUES (1,1,'Map',1);
    INSERT INTO season_template_rounds(season_template_id,round_number,max_score,order_index) VALUES (1,1,100,1);
    INSERT INTO gym_seasons(id,gym_id,season_template_id) VALUES (1,1,1),(2,2,1);`);
  for (const id of [1,2]) require('../engine').recomputeRoundChain(db,id);
  await migrateCredentials(db,{env:{MASTER_ADMIN_CODE:masterPassword}});
  const app = createApp(db,{env:{LEGACY_AUTH_ENABLED:'0',SESSION_SECRETS:'s'.repeat(32),AUTH_RATE_LIMIT_SECRET:'r'.repeat(32)}});
  const server = http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const artifacts = path.join(__dirname,'../tmp/p05-browser'); fs.mkdirSync(artifacts,{recursive:true});
  try {
    browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || (process.platform==='win32'?'msedge':undefined)});
    for (const role of ['master','gym']) await t.test(`${role}: wrong/correct login, refresh, expiry, drafts, change password, logout`, async () => {
      const context = await browser.newContext();
      await context.route('https://fonts.googleapis.com/**',route=>route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(7000);
      const failures=[];const requests=[];
      page.on('pageerror',()=>failures.push('pageerror'));
      page.on('dialog',dialog=>dialog.accept());
      page.on('request',request=>{
        if(request.url().startsWith(base)) requests.push({url:request.url(),method:request.method(),legacy:!!(request.headers()['x-admin-code']||request.headers()['x-master-admin-code']),csrf:!!request.headers()['x-csrf-token']});
      });
      const prefix=role==='master'?'/master':'/g/a/admin';
      const input=role==='master'?'#master-code':'#admin-code';
      const password=role==='master'?masterPassword:'gym-password-a';
      const url=role==='master'?'/master':'/g/a#admin';
      async function login(value) {
        await page.locator(input).fill(value);
        await page.locator('#unlock-btn').click();
      }
      try {
        await page.goto(base+url);
        await page.locator('#lock-box').waitFor({state:'visible'});
        await login('incorrect');
        await page.getByText('Mật khẩu không đúng. Vui lòng thử lại.',{exact:true}).waitFor();
        assert.equal(await page.locator(input).inputValue(),'');
        await login(password);
        await page.locator('#session-controls').waitFor({state:'visible'});
        await page.locator('#unlock-btn').waitFor({state:'hidden'});
        assert.equal(await page.locator(input).inputValue(),'');
        await page.reload();
        await page.locator('#session-controls').waitFor({state:'visible'});
        if(role==='master') {
          await page.locator('[data-tab="gyms"]').click();
          await page.locator('#gym-name').fill('Unsaved gym draft');
        } else await page.locator('.nm-name').first().fill('Unsaved member draft');
        db.prepare('UPDATE auth_sessions SET idle_expires_at=0 WHERE namespace=?').run(role);
        await page.locator(role==='master'?'#gym-submit':'#save-new-members').click();
        await page.locator('#lock-box').waitFor({state:'visible'});
        assert.match(await page.locator('#lock-msg').textContent(),/Phiên đã hết hạn/);
        await login(password);
        await page.locator('#session-controls').waitFor({state:'visible'});
        assert.equal(await page.locator(role==='master'?'#gym-name':'.nm-name').first().inputValue(),role==='master'?'Unsaved gym draft':'Unsaved member draft');
        if(role==='gym') {
          await page.locator('#save-new-members').click();
          await page.getByText('✅ Đã thêm 1 thành viên!',{exact:true}).waitFor();
          assert.equal(db.prepare('SELECT count(*) n FROM members WHERE gym_season_id=1').get().n,1);
        }
        await page.locator('#change-password-btn').click();
        await page.locator('#current-password').fill(password);
        await page.locator('#new-password').fill(password+' updated');
        await page.locator('#change-password-form button[type="submit"]').click();
        await page.getByText('Đã đổi mật khẩu.',{exact:true}).waitFor();
        assert.equal(await page.locator('#current-password').inputValue(),'');
        assert.equal(await page.locator('#new-password').inputValue(),'');
        await page.screenshot({path:path.join(artifacts,role+'-desktop.png'),fullPage:true});
        await page.setViewportSize({width:390,height:844});
        await page.screenshot({path:path.join(artifacts,role+'-mobile.png'),fullPage:true});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});
        assert.equal(await page.evaluate(()=>document.cookie.includes('gvg_')),false);
        await page.locator('#logout-btn').click();
        await page.locator('#lock-box').waitFor({state:'visible'});
        await page.reload();await page.locator('#lock-box').waitFor({state:'visible'});
        assert.equal((await context.request.get(base+prefix+'/auth/session')).status(),401);
        assert.equal(requests.some(r=>r.legacy || r.url.endsWith('/verify')),false);
        assert.ok(requests.filter(r=>r.method==='POST' && r.url.endsWith('/auth/logout')).every(r=>r.csrf));
        assert.equal(failures.length,0);
      } finally {await context.close();}
    });
    await t.test('403 never retries mutation; failed logout keeps UI honest; login clears input during request', async()=>{
      const context=await browser.newContext();
      await context.route('https://fonts.googleapis.com/**',route=>route.abort());
      const page=await context.newPage();
      await page.goto(base+'/master');
      let releaseLogin;
      const pending = new Promise(resolve=>{releaseLogin=resolve;});
      await page.route('**/master/auth/login',async route=>{await pending;await route.continue();});
      await page.locator('#master-code').fill(masterPassword+' updated');
      await page.locator('#unlock-btn').click();
      assert.equal(await page.locator('#master-code').inputValue(),'');
      releaseLogin();await page.locator('#session-controls').waitFor({state:'visible'});
      await page.locator('[data-tab="gyms"]').click();await page.locator('#gym-name').fill('Rejected draft');
      let writes=0;
      await page.route('**/master/gyms',async route=>{
        if(route.request().method()==='POST') {
          writes++;const headers={...route.request().headers()};delete headers['x-csrf-token'];
          await route.continue({headers});
        }else await route.continue();
      });
      await page.locator('#gym-submit').click();await page.locator('#gym-msg').filter({hasText:'Bạn không có quyền'}).waitFor();
      assert.equal(writes,1);assert.equal(await page.locator('#panel').isVisible(),true);
      assert.equal(db.prepare('SELECT count(*) n FROM gyms').get().n,2);
      await page.route('**/master/auth/logout',route=>route.abort());
      await page.locator('#logout-btn').click();await page.locator('#session-msg').filter({hasText:'Không thể kết nối'}).waitFor();
      assert.equal(await page.locator('#panel').isVisible(),true);
      assert.equal((await context.request.get(base+'/master/auth/session')).status(),200);
      await page.unroute('**/master/auth/logout');await page.locator('#logout-btn').click();
      await page.locator('#lock-box').waitFor({state:'visible'});await context.close();
    });
    await t.test('simultaneous roles and wrong Gym cannot access or mutate another tenant', async()=>{
      const context=await browser.newContext();
      await context.route('https://fonts.googleapis.com/**',route=>route.abort());
      const master=await context.newPage(),gym=await context.newPage();
      for(const [page,url,input,password] of [[master,'/master','#master-code',masterPassword+' updated'],[gym,'/g/a#admin','#admin-code','gym-password-a updated']]) {
        await page.goto(base+url);await page.locator(input).fill(password);await page.locator('#unlock-btn').click();
        await page.locator('#session-controls').waitFor({state:'visible'});
      }
      await master.reload();await master.locator('#session-controls').waitFor({state:'visible'});
      await gym.goto(base+'/g/b#admin');await gym.getByText(/Bạn không có quyền thực hiện/).waitFor();
      assert.equal(await gym.locator('#panel').isVisible(),false);
      assert.equal((await context.request.post(base+'/g/b/admin/members/bulk',{headers:{Origin:base},data:{members:[{name:'intruder'}]}})).status(),403);
      const gymOnly=await browser.newContext();
      await gymOnly.addCookies((await context.cookies()).filter(c=>c.name==='gvg_gym_session'));
      assert.equal((await gymOnly.request.get(base+'/master/gyms')).status(),401);
      assert.equal(db.prepare('SELECT count(*) n FROM members WHERE gym_season_id=2').get().n,0);
      await gymOnly.close();await context.close();
    });
  } finally {
    if(browser) await browser.close();app.locals.auth.close();await new Promise(resolve=>server.close(resolve));db.close();
  }
});

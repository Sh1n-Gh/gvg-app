const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const output = path.join(__dirname, '../docs/P23-RESULTS.json');
function stats(values) {
  values = [...values].sort((a,b) => a-b);
  return Object.fromEntries([50,95,99].map(p => [`p${p}_ms`, +(values[Math.max(0, Math.ceil(values.length*p/100)-1)] || 0).toFixed(2)]));
}
async function fixture() {
  const child = fork(path.join(__dirname, '../test/p23-server.js'), [], { stdio: ['ignore','ignore','inherit','ipc'] });
  const timer = setTimeout(() => child.kill(), 180000);
  const message = await Promise.race([once(child,'message').then(([m])=>m), once(child,'exit').then(()=>{throw Error('Fixture failed');})]);
  const base = `http://127.0.0.1:${message.port}`;
  return { base, async close() { child.send('close'); const [m] = await once(child,'message'); await once(child,'exit'); clearTimeout(timer); return m.closed; } };
}
async function load() {
  const results = [];
  for (const concurrency of [1,4,8,16,32,64,128]) {
    const f = await fixture(); const samples = []; let successfulWrites = 0;
    try {
      const response = await fetch(f.base+'/g/fixture-1/admin/auth/login', { method:'POST', headers:{Origin:f.base,'Content-Type':'application/json'}, body:JSON.stringify({password:'fixture-password-1'}) });
      assert.equal(response.status,200);
      const csrf = (await response.json()).csrf_token, cookie = response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
      const headers = { Origin:f.base, Cookie:cookie, 'X-CSRF-Token':csrf,'Content-Type':'application/json' };
      for (const route of ['state','overview','leaderboard','log']) { const r=await fetch(f.base+'/g/fixture-1/'+route); assert.equal(r.status,200); await r.arrayBuffer(); }
      let next = 0; const start = performance.now();
      await Promise.all(Array.from({length:concurrency}, async()=> {
        while (next < 240) {
          const i=next++, kind=['state','overview','leaderboard','log','write','write'][i%6];
          const t=performance.now(); let status=0;
          try {
            const r=await fetch(f.base+'/g/fixture-1/'+(kind==='write'?'admin/entries':kind), {headers, signal:AbortSignal.timeout(15000), ...(kind==='write'?{method:'POST',body:JSON.stringify({member_id:1,map_id:1,tickets_used:1,points_scored:1})}:{})});
            const body=await r.json(); status=r.status;
            if(status===200) { assert.ok(body && typeof body==='object'); if(kind==='write') successfulWrites++; }
          } catch { status=0; }
          samples.push({kind,status,ms:performance.now()-t});
        }
      }));
      const elapsed=performance.now()-start;
      const groups = Object.fromEntries(['all','state','overview','leaderboard','log','write'].map(kind=> {
        const s=samples.filter(x=>kind==='all'||x.kind===kind), errors=s.filter(x=>x.status!==200).length;
        return [kind,{requests:s.length,...stats(s.map(x=>x.ms)),errors,error_rate:errors/s.length,statuses:s.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{})}];
      }));
      const integrity=await f.close(); assert.equal(integrity.entries,10000+successfulWrites); assert.equal(integrity.integrity,'ok'); assert.deepEqual(integrity.foreignKeys,[]);
      results.push({concurrency,elapsed_ms:Math.round(elapsed),requests_per_second:+(240000/elapsed).toFixed(2),groups,integrity});
      console.log('load',concurrency,JSON.stringify(groups.all));
      if(groups.all.error_rate>0.05 || groups.all.p99_ms>5000) break;
    } catch(e) { await f.close(); throw e; }
  }
  return results;
}
async function browserQA() {
  const pw=require('playwright'), results=[];
  for(const name of (process.argv.includes('--firefox-only')?['firefox']:['chrome','msedge','firefox'])) {
    let browser;
    try { browser=await (name==='firefox'?pw.firefox:pw.chromium).launch({headless:true,...(name==='firefox'?{}:{channel:name})}); }
    catch(e) { results.push({browser:name,unavailable:e.message.split('\n')[0]}); continue; }
    const f=await fixture(); const record={browser:name,version:browser.version(),views:[],errors:[],links:[],filters:[]}; results.push(record);
    try {
      const context=await browser.newContext();
      // Deterministic offline-font layout; external links are probed separately.
      await context.route('**/*',r=>new URL(r.request().url()).origin===f.base?r.continue():r.abort());
      const page=await context.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror',e=>record.errors.push(e.message));
      record.failedRequests=[];
      page.on('requestfailed',r=>record.failedRequests.push({url:r.url(),error:r.failure()?.errorText}));
      await context.request.post(f.base+'/g/fixture-1/admin/auth/login',{data:{password:'fixture-password-1'},headers:{Origin:f.base}});
      await page.goto(f.base+'/g/fixture-1');
      await page.locator('#score-overview table').waitFor();
      await page.locator('#session-controls').waitFor({state:'attached'});
      for(const [width,height] of [[320,740],[360,800],[390,844],[412,915],[768,1024],[1024,768],[1440,900]]) {
        await page.setViewportSize({width,height});
        for(const tab of ['dashboard','leaderboard','log','admin']) {
          await page.locator(`#public-tabs > [data-tab="${tab}"]`).click();
          if(tab==='leaderboard') await page.locator('#leaderboard-list > *').first().waitFor();
          if(tab==='log') await page.locator('#log-list > *').first().waitFor();
          if(tab==='admin') { await page.locator('[data-admin-tab="entries"]').click(); await page.locator('#log-filter-member option').nth(1).waitFor({state:'attached'}); }
          await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
          const audit=await page.evaluate(()=>({
            overflow:document.documentElement.scrollWidth>innerWidth+1,
            width:document.documentElement.scrollWidth,
            missingNames:[...document.querySelectorAll('button,input,select,textarea')].filter(e=>e.getClientRects().length&&!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')&&!(e.labels&&[...e.labels].some(l=>l.textContent.trim()))).map(e=>e.id||e.className),
            imagesWithoutAlt:[...document.images].filter(e=>!e.hasAttribute('alt')).length,
            meta:{title:document.title,lang:document.documentElement.lang,viewport:!!document.querySelector('meta[name=viewport]'),description:!!document.querySelector('meta[name=description]'),favicon:!!document.querySelector('link[rel~=icon]')}
          }));
          if(tab==='leaderboard') {
            audit.clippedTicketGroups=await page.locator('.leaderboard-ticket-list').evaluateAll(groups=>groups.filter(group=>{
              const bounds=group.getBoundingClientRect();
              return [...group.children].some(child=>{const r=child.getBoundingClientRect();return r.left<bounds.left-1||r.right>bounds.right+1;});
            }).length);
            assert.equal(audit.clippedTicketGroups,0);
          }
          record.views.push({width,height,tab,...audit});
          if([320,768,1440].includes(width)) {
            const target=path.join(__dirname,'../tmp/p23',`${name}-${width}-${tab}.png`); fs.mkdirSync(path.dirname(target),{recursive:true});
            await page.locator(tab==='dashboard'?'#score-overview':tab==='admin'?'#admin-log-list':tab==='log'?'#log-list':'#leaderboard-list').scrollIntoViewIfNeeded();
            await page.screenshot({path:target});
          }
          if(tab==='log'||tab==='admin') {
            const prefix=tab==='log'?'public-log':'log', samples=[];
            for(let n=0;n<20;n++) {
              samples.push(await page.evaluate(async({prefix,n})=>{
                const start=performance.now(), select=document.getElementById(prefix+'-filter-member');
                select.value=n%2?'':'1';select.dispatchEvent(new Event('change',{bubbles:true}));
                const count=document.querySelectorAll((prefix==='public-log'?'#log-list':'#admin-log-list')+' .log-card').length;
                const expected=n%2?(prefix==='public-log'?300:50):3;
                if(count!==expected) throw Error(`Filter returned ${count}, expected ${expected}`);
                await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
                return performance.now()-start;
              },{prefix,n}));
            }
            record.filters.push({width,tab,samples:20,...stats(samples)});
            if(tab==='admin') {
              const row=page.locator('#admin-log-list .log-card').first();
              await row.locator('.ed-edit').click();
              assert.equal(await row.getByRole('spinbutton',{name:'Điểm đạt được'}).count(),1);
              assert.equal(await row.getByRole('combobox',{name:'Số vé đã dùng'}).count(),1);
              assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
              await row.locator('.ed-cancel').click();
            }
          }
        }
      }
      for(const route of ['/','/master','/g/fixture-1','/missing-p23','/uploads/map-images/p23-error']) {
        const response=await page.goto(f.base+route); const html=await page.content();
        record.links.push({route,status:response.status(),canaryLeak:html.includes('p23-private-error-canary')});
        const refs=await page.locator('a[href],link[rel="stylesheet"],link[rel~="icon"],script[src],img[src]').evaluateAll(es=>es.map(e=>e.href||e.src));
        for(const url of [...new Set(refs)]) if(new URL(url).origin===f.base) { const r=await context.request.get(url); record.links.push({route:new URL(url).pathname,status:r.status()}); }
        else { try { const r=await context.request.get(url,{timeout:10000}); record.links.push({external:url,status:r.status()}); } catch {record.links.push({external:url,checked:false});} }
      }
      await page.goto(f.base+'/g/fixture-1'); await page.keyboard.press('Tab');
      record.keyboard=await page.evaluate(()=>({tag:document.activeElement.tagName,text:document.activeElement.textContent.trim(),outline:getComputedStyle(document.activeElement).outlineStyle}));
      await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
      record.keyboard.leaderboardActivated=await page.locator('#tab-leaderboard').evaluate(e=>e.classList.contains('active'));
    } catch(e) { record.errors.push(e.message); console.error(name,e.message); }
    finally { record.integrity=await f.close(); await browser.close(); }
    console.log('browser',name,'views',record.views.length,'errors',record.errors.length);
  }
  return results;
}
(async()=>{
  const prior=process.argv.some(x=>['--browser-only','--firefox-only'].includes(x))?JSON.parse(fs.readFileSync(output,'utf8')):null;
  const report={at:new Date().toISOString(),node:process.version,os:`${os.platform()} ${os.release()}`,cpu:os.cpus()[0].model,fixture:{entries:10000,members:100,maps:5,nodeInstances:1},loadAt:prior?.loadAt||prior?.at||new Date().toISOString(),load:prior?prior.load:await load(),browsers:await browserQA()};
  if(process.argv.includes('--firefox-only')) report.browsers=[...prior.browsers.filter(b=>b.browser!=='firefox'),...report.browsers];
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n'); console.log(output);
  if(report.browsers.some(b=>b.unavailable||b.errors.length||b.views.length!==28||b.views.some(v=>v.overflow||v.missingNames.length||v.imagesWithoutAlt))) process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});

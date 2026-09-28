// Temporary P24.2f observation only; enabled by VISUAL_DOM_CAPTURE_DIR.
const fs = require('node:fs');
const path = require('node:path');
async function captureBbox(page, label, target) {
  const dir = process.env.VISUAL_DOM_CAPTURE_DIR;
  const bbox = { '390/member-edit': [0,255,389,636], '1440/dashboard': [0,255,1439,935] }[target];
  if (!dir || !bbox) return;
  const state = await page.evaluate(bbox => {
    const selector = el => {
      if (!el) return null;
      if (el.id) return '#' + CSS.escape(el.id);
      if (!el.parentElement) return el.tagName.toLowerCase();
      return selector(el.parentElement) + ' > ' + el.tagName.toLowerCase() + ':nth-child(' + ([...el.parentElement.children].indexOf(el)+1) + ')';
    };
    const styles = (el, pseudo) => { const s = getComputedStyle(el, pseudo); return Object.fromEntries([...s].sort().map(k => [k,s.getPropertyValue(k)])); };
    const elements = [...document.querySelectorAll('body, body *')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width && r.height && r.right+scrollX>bbox[0] && r.left+scrollX<=bbox[2] && r.bottom+scrollY>bbox[1] && r.top+scrollY<=bbox[3];
    }).map(el => ({selector:selector(el), outerHTML:el.outerHTML, rect:el.getBoundingClientRect().toJSON(), style:styles(el), before:styles(el,'::before'), after:styles(el,'::after'), value:el.value ?? null, image:el instanceof HTMLImageElement ? {currentSrc:el.currentSrc,complete:el.complete,naturalWidth:el.naturalWidth,naturalHeight:el.naturalHeight}:null}));
    const hits = [];
    for (const x of [bbox[0], Math.floor((bbox[0]+bbox[2])/2),bbox[2]]) for(const y of [bbox[1],Math.floor((bbox[1]+bbox[3])/2),bbox[3]]) {
      hits.push({x,y,stack:document.elementsFromPoint(x-scrollX,y-scrollY).map(selector)});
    }
    return {bbox,scrollX,scrollY,innerWidth,innerHeight,activeElement:selector(document.activeElement),hits,elements};
  }, bbox);
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir, `${label}.json`), JSON.stringify(state,null,2));
}
module.exports = {captureBbox};

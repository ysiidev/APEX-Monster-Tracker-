const {JSDOM} = require('jsdom');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const app = path.join(__dirname, '../app');
(async () => {
  const dom = new JSDOM('<html class="staff-authenticated"><body><div class="wrap"><div class="num">₱950</div></div></body></html>', {runScripts:'outside-only', pretendToBeVisual:true});
  const w = dom.window, number = w.document.querySelector('.num');
  let reduced = false, change, calls = 0, cancelled = 0;
  w.matchMedia = () => ({get matches(){return reduced;}, addEventListener(type, fn){change=fn;}});
  number.getClientRects = () => [{width:40,height:20}];
  number.getAnimations = () => [];
  number.animate = () => {calls++; return {cancel(){cancelled++; if(this.oncancel)this.oncancel();}};};
  w.eval(fs.readFileSync(path.join(app,'motion.js'),'utf8'));
  await new Promise(resolve => w.document.addEventListener('DOMContentLoaded',resolve));
  number.textContent = '₱1,045.17';
  await new Promise(resolve => setTimeout(resolve,60));
  assert.equal(calls,1); assert.equal(number.textContent,'₱1,045.17');
  reduced=true; change(); assert.equal(cancelled,1);
  number.textContent='₱0.01';
  await new Promise(resolve => setTimeout(resolve,60));
  assert.equal(calls,1); assert.equal(number.textContent,'₱0.01');
  const css=fs.readFileSync(path.join(app,'motion.css'),'utf8');
  assert.ok(css.includes('prefers-reduced-motion: reduce'));
  for(const asset of ['motion.css','motion.js','cloud.js','staff-login.css']){
    for(const installer of ['setup.nsi','setup.wxs']) assert.ok(fs.readFileSync(path.join(app,'..',installer),'utf8').includes(asset),installer+' must package '+asset);
  }
  dom.window.close(); console.log('PASS: exact financial values preserved, update animation, reduced-motion cancellation, EXE/MSI asset manifests');
})().catch(e=>{console.error(e);process.exit(1);});

// No live email or financial writes. Exercises auth, save, conflict and access errors.
const {JSDOM} = require('jsdom');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const app = path.join(__dirname, '../app');
(async () => {
 const dom = new JSDOM('<div class="wrap"></div><button id="backup-data"></button><button id="restore-data"></button><span id="backup-status"></span>', {url:'https://tracker.test', runScripts:'outside-only'});
 const style = dom.window.document.createElement('style');
 style.textContent = 'form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr));gap:12px; }\n' + fs.readFileSync(path.join(app,'staff-login.css'),'utf8');
 dom.window.document.head.appendChild(style);
 const w = dom.window; w.__APEX_SEED__ = JSON.parse(fs.readFileSync(path.join(app,'snapshot.json')));
 w.AbortController = AbortController; w.confirm = () => true;
 let payload = structuredClone(w.__APEX_SEED__), revision = 1, conflict = false, offline = false;
 w.fetch = async (url, options) => {
  if (offline) throw Error('offline');
  let value;
  if ((url.includes('/auth/v1/verify') || url.includes('grant_type=password'))) value = {access_token:'test', refresh_token:'test', expires_at:Date.now()/1000+3600, user:{email:'mysidrareyes@gmail.com'}};
  else if (url.includes('/rpc/')) {
   const body = JSON.parse(options.body);
   if (conflict || body.expected_revision !== revision) value = [];
   else { payload = body.new_payload; revision++; value = [{payload,revision}]; }
  } else value = [{payload,revision}];
  return {ok:true, json:async()=>value};
 };
 w.eval(fs.readFileSync(path.join(app,'cloud.js'),'utf8'));
 w.eval(fs.readFileSync(path.join(app,'bridge.js'),'utf8'));
 await new Promise(resolve => w.document.addEventListener('DOMContentLoaded', resolve));
 const db = await w.claude.use('db');
 assert.equal(w.document.getElementById('portal-title').textContent,'APEX Monster Tracker');
 const loginStyle = w.getComputedStyle(w.document.getElementById('cloud-password-controls'));
 assert.equal(loginStyle.display,'flex');
 assert.equal(loginStyle.flexDirection,'column');
 assert.equal(loginStyle.gap,'0');

 assert.equal(w.ApexCloud.active(),false);
 assert.equal(w.document.documentElement.classList.contains('staff-authenticated'),false);
 assert.equal(w.document.getElementById('cloud-send'),null);
 assert.equal(w.document.getElementById('cloud-verify'),null);
 assert.equal(w.document.getElementById('cloud-token'),null);
 w.document.getElementById('cloud-email').value = 'admin';
 w.document.getElementById('cloud-password').value = 'test-only-long-password';
 await w.document.getElementById('cloud-password-controls').onsubmit({preventDefault(){}});
 assert.equal(w.ApexCloud.active(),true);
 assert.equal(w.document.documentElement.classList.contains('staff-authenticated'),true);
 await db.collection('sales').add({buyer:'Test', qty:1});
 assert.equal(payload.sales.length,11);
 const before = w.localStorage.getItem('apex-monster-preview-data');
 conflict = true;
 await assert.rejects(db.collection('sales').add({buyer:'Conflict'}), /Another device/);
 assert.equal(w.localStorage.getItem('apex-monster-preview-data'),before);
 conflict = false; offline = true;
 await assert.rejects(db.collection('sales').add({buyer:'Offline'}), /offline/);
 assert.equal(w.localStorage.getItem('apex-monster-preview-data'),before);
 w.document.getElementById('restore-data').onclick();
 assert.match(w.document.getElementById('backup-status').textContent,/Disconnect cloud/);
 w.document.getElementById('cloud-out').onclick();
 assert.equal(w.ApexCloud.active(),false);
 assert.equal(w.document.documentElement.classList.contains('staff-authenticated'),false);
 assert.ok(w.localStorage.getItem('apex-monster-preview-backup'));
 offline = false;
 w.document.getElementById('cloud-email').value = 'admin';
 w.document.getElementById('cloud-password').value = 'test-only-long-password';
 await w.document.getElementById('cloud-password-controls').onsubmit({preventDefault(){}});
 assert.equal(w.ApexCloud.active(),true);
 assert.equal(w.document.documentElement.classList.contains('staff-authenticated'),true);
 assert.equal(w.document.getElementById('cloud-password').value,'');
 assert.ok(!w.localStorage.getItem('apex-monster-preview-data').includes('test-only-long-password'));
 w.document.getElementById('cloud-out').onclick();
 dom.window.close(); console.log('PASS: cloud sign-in, backup, save, conflict rejection, offline rejection, restore guard, disconnect');
})().catch(e => {console.error(e); process.exit(1);});

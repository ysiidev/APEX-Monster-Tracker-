// End-to-end check of the Back up / Restore controls in the browser preview.
// Exercises bridge.js's localStorage host for real: record a sale, back up, record
// another, restore, and confirm the state rolls back exactly.
// Run from desktop/ (needs jsdom):  node preview/check-backup.js
const {spawn} = require('child_process'), path = require('path'), assert = require('assert');
const {JSDOM, VirtualConsole} = require('jsdom');

const PORT = 8098;
const child = spawn(process.execPath, [path.join(__dirname, 'server.js'), String(PORT)], {stdio: 'ignore'});
const done = code => { try { child.kill(); } catch (e) {} process.exit(code); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 50; i++) {
    try { await fetch('http://127.0.0.1:' + PORT + '/'); break; } catch (e) { await sleep(100); }
  }
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', e => errors.push(String(e)));
  const dom = await JSDOM.fromURL('http://127.0.0.1:' + PORT + '/?reset=1', {
    runScripts: 'dangerously', resources: 'usable', virtualConsole: vc,
    beforeParse(w) { w.scrollTo = () => {}; }
  });
  await sleep(1000);
  const w = dom.window, d = w.document, store = w.localStorage;
  const DATA = 'apex-monster-preview-data', BAK = 'apex-monster-preview-backup';
  const count = () => JSON.parse(store.getItem(DATA)).sales.length;
  const logRows = () => d.querySelectorAll('#dlog .dl-list li').length;
  const addSale = async buyer => {
    d.querySelector('#f-buyer').value = buyer;
    d.querySelector('#f-qty').value = '1';
    d.querySelector('#f-price').value = '95';
    d.querySelector('#sale-form').dispatchEvent(new w.Event('submit', {bubbles: true, cancelable: true}));
    await sleep(250);
  };

  console.log('1. start            ', count(), 'sales ·', logRows(), 'log rows (seed)');
  assert.equal(count(), 10);
  assert.equal(logRows(), 10);

  await addSale('BACKUP TEST ONE');
  console.log('2. sale recorded    ', count(), 'sales ·', logRows(), 'log rows');
  assert.equal(count(), 11);
  assert.equal(logRows(), 11, 'daily log picks up the new sale');

  d.querySelector('#backup-data').click(); await sleep(250);
  const backupMsg = d.querySelector('#backup-status').textContent.trim();
  console.log('3. backup clicked    status:', JSON.stringify(backupMsg));
  assert.equal(backupMsg, 'Backup saved.', 'backup reports success');
  assert.equal(JSON.parse(store.getItem(BAK)).sales.length, 11, 'backup holds 11 sales');
  assert(store.getItem(BAK) === store.getItem(DATA), 'backup is a copy of the live data');

  await addSale('BACKUP TEST TWO');
  console.log('4. second sale      ', count(), 'sales ·', logRows(), 'log rows');
  assert.equal(count(), 12);

  d.querySelector('#restore-data').click(); await sleep(300);
  const restoreMsg = d.querySelector('#backup-status').textContent.trim();
  console.log('5. restore clicked   status:', JSON.stringify(restoreMsg));
  assert.equal(restoreMsg, 'Backup restored.', 'restore reports success');
  assert.equal(count(), 11, 'restore rolled back the second sale');
  assert.equal(logRows(), 11, 'daily log redrew after restore');

  const buyers = JSON.parse(store.getItem(DATA)).sales.map(s => s.buyer);
  assert(buyers.includes('BACKUP TEST ONE'), 'the backed-up sale survived');
  assert(!buyers.includes('BACKUP TEST TWO'), 'the post-backup sale is gone');
  console.log('6. after restore    ', count(), 'sales · kept "BACKUP TEST ONE":', buyers.includes('BACKUP TEST ONE'),
              '· dropped "BACKUP TEST TWO":', !buyers.includes('BACKUP TEST TWO'));

  // shape must still satisfy the desktop host's validation (collections + docs + unique ids)
  const data = JSON.parse(store.getItem(DATA));
  for (const c of ['sales', 'restocks', 'refmoves', 'money', 'oct_batches']) assert(Array.isArray(data[c]), c + ' collection intact');
  for (const doc of ['settings/main', 'oct/config']) assert(data[doc] && typeof data[doc] === 'object', doc + ' intact');
  assert.equal(new Set(data.sales.map(s => s.id)).size, data.sales.length, 'ids still unique after restore');
  console.log('7. shape           ', 'collections + docs intact, ids unique');

  // a restore with no backup taken must not destroy anything
  store.removeItem(BAK);
  d.querySelector('#restore-data').click(); await sleep(300);
  console.log('8. restore w/o backup status:', JSON.stringify(d.querySelector('#backup-status').textContent.trim()), '· count still', count());
  assert.equal(count(), 11, 'failed restore leaves data alone');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nPASS: backup captures the live file, restore rolls back exactly, and a missing backup is harmless');
  dom.window.close();
  done(0);
})().catch(e => { console.error('FAIL', e.message); done(1); });

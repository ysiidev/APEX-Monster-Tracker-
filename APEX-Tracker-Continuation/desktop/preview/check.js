// Smoke check for the browser preview: boots preview/server.js on a spare port, loads the
// page the way a browser would, and asserts the Daily log matches the snapshot.
// Run from desktop/ (needs the jsdom package):  node preview/check.js
const {spawn} = require('child_process'), path = require('path'), fs = require('fs'), assert = require('assert');
const {JSDOM, VirtualConsole} = require('jsdom');

const PORT = 8099;
const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'snapshot.json'), 'utf8'));
const expected = snapshot.sales.filter(s => (s.buyer || '').trim()).sort((a, b) => a.ts - b.ts);

const child = spawn(process.execPath, [path.join(__dirname, 'server.js'), String(PORT)], {stdio: 'ignore'});
const done = code => { try { child.kill(); } catch (e) {} process.exit(code); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 50; i++) {                       // wait for the port to accept connections
    try { await fetch('http://127.0.0.1:' + PORT + '/'); break; } catch (e) { await sleep(100); }
  }
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', e => errors.push(String(e)));
  const dom = await JSDOM.fromURL('http://127.0.0.1:' + PORT + '/?reset=1', {
    runScripts: 'dangerously', resources: 'usable', virtualConsole: vc,
    beforeParse(w) { w.scrollTo = () => {}; }
  });
  await sleep(1200);
  const d = dom.window.document;
  assert.deepEqual(errors, [], 'page errors');
  assert.equal(d.getElementById('banner').hidden, true, 'data loaded without a banner warning');
  assert.equal(d.getElementById('view-tracker').hidden, false, 'preview should open on the tracker view');

  const days = [...d.querySelectorAll('#dlog .dl-day')];
  const rows = [...d.querySelectorAll('#dlog .dl-list li')];
  assert.equal(rows.length, expected.length, `${rows.length} rows vs ${expected.length} named sales`);
  assert.deepEqual(rows.map(li => li.querySelector('.dl-buyer').textContent.trim()),
                   expected.map(s => s.buyer.trim()), 'rows must be oldest first');

  days.forEach(day => {
    console.log('\n' + day.querySelector('.dl-date').textContent.trim());
    day.querySelectorAll('li').forEach(li =>
      console.log('  ' + li.querySelector('.dl-buyer').textContent.trim() + ' — ' +
                  li.querySelector('.dl-meta').textContent.trim()));
  });
  console.log(`\nPASS: preview server renders all ${rows.length} named sales in ${days.length} day groups`);
  assert.equal(d.getElementById('backup-data') !== null, true, 'backup control present in preview mode');
  done(0);
})().catch(e => { console.error('FAIL', e.message); done(1); });

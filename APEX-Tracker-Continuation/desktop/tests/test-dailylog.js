// Daily log regression test: boots the app with app/snapshot.json and checks that every
// named-buyer sale is listed, grouped by calendar day, oldest first.
// Run from the desktop/ directory:  node tests/test-dailylog.js
const {JSDOM, VirtualConsole} = require('jsdom'); const fs = require('fs'); const assert = require('assert');
let data = JSON.parse(fs.readFileSync('app/snapshot.json', 'utf8'));
const errors = [];
const wait = () => new Promise(r => setTimeout(r, 200));

// expected rows come from the snapshot, not from a hardcoded list
const expected = data.sales.filter(s => (s.buyer || '').trim()).sort((a, b) => a.ts - b.ts);

(async () => {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', e => errors.push(String(e)));
  const dom = await JSDOM.fromFile('app/index.html', {
    runScripts: 'dangerously', resources: 'usable', virtualConsole: vc,
    beforeParse(w) {
      let listener; w.scrollTo = () => {};
      w.chrome = {webview: {
        addEventListener(t, f) { listener = f; },
        postMessage(req) {
          let value = null;
          if (req.op === 'read') value = data;
          if (req.op === 'write') data = JSON.parse(JSON.stringify(req.value));
          if (req.op === 'backup' || req.op === 'csv') value = true;
          setTimeout(() => listener({data: {id: req.id, value: JSON.parse(JSON.stringify(value))}}), 0);
        }
      }};
    }
  });
  await wait();
  const d = dom.window.document;
  assert.deepEqual(errors, [], 'page errors');

  dom.window.location.hash = 'tracker'; await wait();

  const days = [...d.querySelectorAll('#dlog .dl-day')];
  const rows = [...d.querySelectorAll('#dlog .dl-list li')];
  assert.equal(rows.length, expected.length,
    `daily log shows ${rows.length} rows, snapshot has ${expected.length} named sales`);

  // buyer order across the whole log must match the snapshot sorted oldest first
  const buyers = rows.map(li => li.querySelector('.dl-buyer').textContent.trim());
  assert.deepEqual(buyers, expected.map(s => s.buyer.trim()), 'rows must be oldest first');

  // one group per calendar day, groups in ascending order
  const expectedDays = [...new Set(expected.map(s => new Date(s.ts).toDateString()))];
  assert.equal(days.length, expectedDays.length,
    `expected ${expectedDays.length} day groups, got ${days.length}`);
  const headings = days.map(x => x.querySelector('.dl-date').textContent.trim());
  assert.deepEqual([...headings], [...headings].sort((a, b) =>
    new Date(a.replace('.', '')) - new Date(b.replace('.', ''))), 'day groups must be oldest first');

  // every row inside a group belongs to that group's day
  const perDay = {};
  expected.forEach(s => { (perDay[new Date(s.ts).toDateString()] ||= []).push(s.buyer.trim()); });
  days.forEach(day => {
    const key = new Date(day.querySelector('.dl-date').textContent.trim().replace('.', '')).toDateString();
    const got = [...day.querySelectorAll('li')].map(li => li.querySelector('.dl-buyer').textContent.trim());
    const want = perDay[key];
    assert(want, `unexpected day group: ${key}`);
    assert.deepEqual(got, want, `rows under ${key} must match the snapshot for that day`);
  });

  // no duplicate ids in the data feeding the log
  assert.equal(new Set(expected.map(s => s.id)).size, expected.length, 'duplicate sale ids');

  days.forEach(day => {
    console.log('\n' + day.querySelector('.dl-date').textContent.trim());
    day.querySelectorAll('li').forEach(li =>
      console.log('  ' + li.querySelector('.dl-buyer').textContent.trim() + ' — ' +
                  li.querySelector('.dl-meta').textContent.trim()));
  });
  console.log(`\nPASS: daily log lists all ${rows.length} named sales in ${days.length} day groups, oldest first`);
  dom.window.close();
})().catch(e => { console.error(e); process.exit(1); });

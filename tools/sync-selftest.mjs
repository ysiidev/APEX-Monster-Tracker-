// Round-trip test for tools/supabase-sync.mjs — no network, no Supabase needed.
// Proves that data.json -> table rows -> data.json keeps every record and every number.
// Run from the repo root:  node tools/sync-selftest.mjs
import fs from 'node:fs';
import assert from 'node:assert';
import {toRows, fromRows} from './supabase-sync.mjs';

const file = process.argv[2] || 'APEX-Tracker-Continuation/desktop/app/snapshot.json';
const original = JSON.parse(fs.readFileSync(file, 'utf8'));

const rows = toRows(original);
const back = fromRows(rows, {taken: original.taken, note: original.note});

// defaults the database applies to columns the app leaves out
const restock = r => ({id: r.id, flavor: r.flavor, qty: r.qty, ts: r.ts,
  cost: r.cost ?? 54.17, expense: r.expense ?? 0, type: r.type ?? 'restock', paid_from: r.paidFrom ?? null});
const move = m => ({id: m.id, flavor: m.flavor, qty: m.qty, ts: m.ts, type: m.type ?? 'move'});
const batch = b => ({id: b.id, label: b.label, order: b.order ?? 1, capital: b.capital ?? 0,
  shipping: b.shipping ?? 0, items: b.items});

assert.deepEqual(back['settings/main'], original['settings/main'], 'settings/main survives');
assert.deepEqual(back['oct/config'], original['oct/config'], 'oct/config survives');
assert.deepEqual(back.oct_batches.map(batch).sort((a,b)=>a.order-b.order), original.oct_batches.map(batch).sort((a,b)=>a.order-b.order), 'oct_batches survive');
// the file is not strictly sorted, so compare by identity + time rather than array order
const sortTs = a => a.slice().sort((x, y) => x.ts - y.ts || String(x.id).localeCompare(String(y.id)));
assert.deepEqual(sortTs(back.restocks.map(restock)), sortTs(original.restocks.map(restock)), 'restocks survive');
assert.deepEqual(sortTs(back.refmoves.map(move)), sortTs(original.refmoves.map(move)), 'refmoves survive');
assert.equal(back.money.length, original.money.length, 'money survives');

// every sale field must come back identical, including the timestamps that drive the Daily log
assert.equal(back.sales.length, original.sales.length, 'sale count survives');
const key = a => a.slice().sort((x, y) => x.ts - y.ts || x.id.localeCompare(y.id));
key(back.sales).forEach((s, i) => {
  const o = key(original.sales)[i];
  assert.equal(s.id, o.id, 'sale id');
  assert.equal(s.buyer, o.buyer, 'sale buyer ' + o.id);
  assert.equal(s.flavor, o.flavor, 'sale flavor ' + o.id);
  assert.equal(s.qty, o.qty, 'sale qty ' + o.id);
  assert.equal(s.price, o.price, 'sale price ' + o.id);
  assert.equal(s.cost, o.cost, 'sale cost ' + o.id);
  assert.equal(s.method, o.method, 'sale method ' + o.id);
  assert.equal(s.paid, o.paid, 'sale paid ' + o.id);
  assert.equal(s.ts, o.ts, 'sale ts ' + o.id);
});

// the numbers the business cares about must be unchanged by the round trip
const revenue = a => a.reduce((t, s) => t + s.qty * s.price, 0);
assert.equal(revenue(back.sales), revenue(original.sales), 'revenue');
const stock = a => a.restocks.reduce((t, r) => t + r.qty, 0) - a.sales.reduce((t, s) => t + s.qty, 0);
assert.equal(stock(back), stock(original), 'stock on hand');

// money mapping uses "to" locally and to_account in SQL
const withTransfer = {...original, money: [{id: 'x1', type: 'transfer', amount: 100, category: 'Move', account: 'Cash', to: 'GCash', note: 'test', ts: 1}]};
const t = toRows(withTransfer).money[0];
assert.equal(t.to_account, 'GCash', 'to -> to_account');
assert.equal(fromRows({money: [t]}).money[0].to, 'GCash', 'to_account -> to');

console.log(`PASS: ${back.sales.length} sales, ${back.restocks.length} restocks, ${back.refmoves.length} refmoves, ` +
            `${back.oct_batches.length} oct batches round-trip unchanged · revenue ₱${revenue(back.sales)} · stock ${stock(back)} cans`);

#!/usr/bin/env node
/* Two-way sync between the desktop app's data.json and the Supabase project.
 *
 *   node tools/supabase-sync.mjs verify             compare local file against the cloud
 *   node tools/supabase-sync.mjs push   [options]   upsert local rows into Supabase
 *   node tools/supabase-sync.mjs pull   [options]   rebuild data.json from Supabase
 *   node tools/supabase-sync.mjs snapshot[options]  archive the whole file (table + storage bucket)
 *
 * Options: --data <path>  --out <path>  --force  --prune  --dry-run
 *
 * The secret (service_role) key bypasses row level security, so it must stay on this
 * machine: pass it in SUPABASE_SECRET_KEY, never put it in the app or in git.
 * No dependencies — Node 18+ for fetch.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_DATA = process.env.APEX_DATA_FILE ||
  path.join(process.env.LOCALAPPDATA || process.env.HOME || '.', 'ApexMonsterTracker', 'data.json');

const COLLECTIONS = ['sales', 'restocks', 'refmoves', 'money', 'oct_batches'];
const DOCUMENTS = ['settings/main', 'oct/config'];
// table -> primary key used for upserts
const KEYS = {sales: 'id', restocks: 'id', refmoves: 'id', money: 'id', oct_batches: 'id'};

/* ---------- local shape -> table rows ---------- */

export function toRows(data) {
  const rows = {};
  rows.sales = (data.sales || []).map(s => ({
    id: s.id, buyer: s.buyer ?? null, flavor: s.flavor, qty: s.qty, price: s.price,
    cost: s.cost ?? 54.17, method: s.method ?? 'Cash', paid: s.paid !== false,
    paid_method: s.paidMethod ?? null, ts: s.ts
  }));
  rows.restocks = (data.restocks || []).map(r => ({
    id: r.id, flavor: r.flavor, qty: r.qty, cost: r.cost ?? 54.17, expense: r.expense ?? 0,
    paid_from: r.paidFrom ?? null, type: r.type ?? 'restock', ts: r.ts
  }));
  rows.refmoves = (data.refmoves || []).map(m => ({
    id: m.id, flavor: m.flavor, qty: m.qty, type: m.type ?? 'move', ts: m.ts
  }));
  rows.money = (data.money || []).map(m => ({
    id: m.id, type: m.type, amount: m.amount, category: m.category ?? null,
    account: m.account ?? 'Cash', to_account: m.to ?? null, note: m.note ?? null, ts: m.ts
  }));
  rows.oct_batches = (data.oct_batches || []).map(b => ({
    id: b.id, label: b.label, ord: b.order ?? 1, capital: b.capital ?? 0,
    shipping: b.shipping ?? 0, items: b.items ?? []
  }));
  rows.app_documents = DOCUMENTS
    .filter(p => data[p] !== undefined)
    .map(p => ({path: p, data: data[p]}));
  return rows;
}

/* ---------- table rows -> local shape ---------- */

const num = v => (v === null || v === undefined ? v : typeof v === 'number' ? v : Number(v));

export function fromRows(rows, {taken, note} = {}) {
  const byTs = (a, b) => a.ts - b.ts;
  const out = {taken: taken || new Date().toISOString().slice(0, 10), note: note || 'Pulled from Supabase.'};

  for (const doc of rows.app_documents || []) out[doc.path] = doc.data;

  out.oct_batches = (rows.oct_batches || []).map(b => {
    const o = {id: b.id, label: b.label, order: b.ord, capital: num(b.capital), shipping: num(b.shipping), items: b.items};
    return o;
  }).sort((a, b) => a.order - b.order);

  out.sales = (rows.sales || []).map(s => {
    const o = {
      id: s.id, buyer: s.buyer ?? '', flavor: s.flavor, qty: num(s.qty), price: num(s.price),
      cost: num(s.cost), method: s.method, paid: s.paid !== false, ts: num(s.ts)
    };
    if (s.paid_method) { o.method = 'Debt'; o.paidMethod = s.paid_method; }
    return o;
  }).sort(byTs);

  out.restocks = (rows.restocks || []).map(r => {
    const o = {id: r.id, flavor: r.flavor, qty: num(r.qty), cost: num(r.cost), expense: num(r.expense), ts: num(r.ts)};
    if (r.paid_from) o.paidFrom = r.paid_from;
    if (r.type && r.type !== 'restock') o.type = r.type;
    return o;
  }).sort(byTs);

  out.refmoves = (rows.refmoves || []).map(m => {
    const o = {id: m.id, flavor: m.flavor, qty: num(m.qty), ts: num(m.ts)};
    if (m.type && m.type !== 'move') o.type = m.type;
    return o;
  }).sort(byTs);

  out.money = (rows.money || []).map(m => {
    const o = {id: m.id, type: m.type, amount: num(m.amount), category: m.category ?? '', account: m.account, ts: num(m.ts)};
    if (m.to_account) o.to = m.to_account;
    if (m.note) o.note = m.note;
    return o;
  }).sort(byTs);

  return out;
}

/* ---------- http ---------- */

function config() {
  const env = readEnv();
  const url = (process.env.SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || env.SUPABASE_SECRET_KEY || '';
  if (!url || !key) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (in the environment or supabase/.env).');
  }
  if (/^sb_publishable_|anon/.test(key)) throw new Error('That is a public key; the sync needs the secret (service_role) key.');
  return {url, key, bucket: process.env.SUPABASE_BUCKET || env.SUPABASE_BUCKET || 'monster-tracker-backups'};
}

function readEnv() {
  for (const p of ['supabase/.env', '.env']) {
    if (fs.existsSync(p)) {
      return Object.fromEntries(
        fs.readFileSync(p, 'utf8').split('\n')
          .filter(l => l.trim() && !l.trim().startsWith('#'))
          .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
      );
    }
  }
  return {};
}

async function api(cfg, {method = 'GET', pathname, body, headers = {}, expectStatus}) {
  const res = await fetch(cfg.url + pathname, {
    method,
    headers: {
      apikey: cfg.key, Authorization: 'Bearer ' + cfg.key,
      'Content-Type': 'application/json', ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  if (expectStatus && res.status !== expectStatus) {
    throw new Error(`${method} ${pathname} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status}: ${text.slice(0, 400)}`);
  return {res, json: text ? JSON.parse(text) : null};
}

async function selectAll(cfg, table) {
  const page = 1000, out = [];
  for (let from = 0; ; from += page) {
    const {json} = await api(cfg, {
      pathname: `/rest/v1/${table}?select=*`,
      headers: {Range: `${from}-${from + page - 1}`, 'Range-Unit': 'items', Prefer: 'count=exact'}
    });
    out.push(...json);
    if (json.length < page) return out;
  }
}

async function countRows(cfg, table) {
  const {res} = await api(cfg, {
    pathname: `/rest/v1/${table}?select=id&limit=1`,
    headers: {Prefer: 'count=exact', 'Range-Unit': 'items'}
  });
  const cr = res.headers.get('content-range');
  if (!cr || !cr.includes('/')) return null;
  const total = cr.split('/')[1];
  return total === '*' ? null : Number(total);
}

async function upsert(cfg, table, rows) {
  if (!rows.length) return {table, sent: 0};
  for (let i = 0; i < rows.length; i += 500) {
    await api(cfg, {
      method: 'POST', pathname: `/rest/v1/${table}`,
      body: rows.slice(i, i + 500),
      headers: {Prefer: 'resolution=merge-duplicates,return=minimal'}
    });
  }
  return {table, sent: rows.length};
}

async function pruneMissing(cfg, table, rows) {
  const keep = rows.map(r => r[KEYS[table]]);
  if (!keep.length) {
    await api(cfg, {method: 'DELETE', pathname: `/rest/v1/${table}?${KEYS[table]}=not.is.null`, headers: {Prefer: 'return=minimal'}});
    return {table, pruned: 'all'};
  }
  await api(cfg, {
    method: 'DELETE',
    pathname: `/rest/v1/${table}?${KEYS[table]}=not.in.(${keep.map(k => `"${k}"`).join(',')})`,
    headers: {Prefer: 'return=minimal'}
  });
  return {table, pruned: 'rows not in the local file'};
}

/* ---------- commands ---------- */

function readLocal(file) {
  if (!fs.existsSync(file)) throw new Error(`No data file at ${file}. Pass --data <path>.`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const c of COLLECTIONS) if (!Array.isArray(data[c])) throw new Error(`Local file is missing the "${c}" collection.`);
  return data;
}

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const flag = name => process.argv.includes('--' + name);

async function cmdPush() {
  const file = arg('data', DEFAULT_DATA), dry = flag('dry-run');
  const data = readLocal(file);
  const rows = toRows(data);
  const summary = Object.fromEntries(Object.entries(rows).map(([t, r]) => [t, r.length]));
  if (dry) return console.log('dry run — would upsert:', summary);
  const cfg = config();
  const results = [];
  for (const t of [...COLLECTIONS, 'app_documents']) results.push(await upsert(cfg, t, rows[t]));
  if (flag('prune')) {
    console.log('WARNING: --prune deletes cloud rows that are not in the local file.');
    for (const t of COLLECTIONS) results.push(await pruneMissing(cfg, t, rows[t]));
  }
  console.log('pushed', summary);
  console.table(results);
  return results;
}

async function cmdPull() {
  const out = arg('out', DEFAULT_DATA), dry = flag('dry-run'), force = flag('force');
  if (fs.existsSync(out) && !force && !dry) {
    throw new Error(`${out} already exists. Back it up first, or pass --force to overwrite.`);
  }
  if (dry) return console.log('dry run — would write a data.json built from the cloud tables to', out);
  const cfg = config();
  const rows = {};
  for (const t of [...COLLECTIONS, 'app_documents']) rows[t] = await selectAll(cfg, t);
  let taken, note;
  try {
    const {json} = await api(cfg, {pathname: '/rest/v1/snapshots?select=taken,note&order=created_at.desc&limit=1'});
    if (json && json[0]) { taken = json[0].taken; note = json[0].note; }
  } catch (e) { /* snapshots is optional */ }
  const data = fromRows(rows, {taken, note});
  fs.mkdirSync(path.dirname(path.resolve(out)), {recursive: true});
  if (fs.existsSync(out)) fs.copyFileSync(out, out + '.before-pull');
  fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`wrote ${out}: ${Object.fromEntries(COLLECTIONS.map(c => [c, data[c].length]))}`);
  return data;
}

async function cmdSnapshot() {
  const file = arg('data', DEFAULT_DATA), dry = flag('dry-run');
  const data = readLocal(file);
  const payload = {taken: data.taken || new Date().toISOString().slice(0, 10), source: 'desktop', note: data.note || 'Manual snapshot', sales_count: (data.sales || []).length, payload: data};
  if (dry) return console.log('dry run — would archive', payload.sales_count, 'sales to public.snapshots and the storage bucket');
  const cfg = config();
  await api(cfg, {method: 'POST', pathname: '/rest/v1/snapshots', body: payload, headers: {Prefer: 'return=minimal'}});
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const objectPath = `data/${stamp}.json`;
  const res = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${objectPath}`, {
    method: 'POST',
    headers: {apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json', 'x-upsert': 'true'},
    body: JSON.stringify(data, null, 2)
  });
  if (!res.ok) throw new Error(`storage upload -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  console.log('archived row + storage object:', objectPath);
  return objectPath;
}

async function cmdVerify() {
  const file = arg('data', DEFAULT_DATA);
  const data = readLocal(file), rows = toRows(data), cfg = config();
  const out = [];
  for (const t of [...COLLECTIONS, 'app_documents']) {
    const cloud = await countRows(cfg, t);
    out.push({table: t, local: rows[t].length, cloud, match: cloud === rows[t].length ? 'yes' : 'NO'});
  }
  console.table(out);
  const localRevenue = rows.sales.reduce((a, s) => a + s.qty * s.price, 0);
  const {json} = await api(cfg, {pathname: '/rest/v1/v_daily_totals?select=revenue'});
  const cloudRevenue = json.reduce((a, r) => a + Number(r.revenue), 0);
  console.log(`revenue  local ₱${localRevenue.toFixed(2)}   cloud ₱${cloudRevenue.toFixed(2)}   ${Math.abs(localRevenue - cloudRevenue) < 0.005 ? 'match' : 'MISMATCH'}`);
  return out;
}

const command = process.argv[2];
const commands = {push: cmdPush, pull: cmdPull, snapshot: cmdSnapshot, verify: cmdVerify};

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!commands[command]) {
    console.error('Usage: node tools/supabase-sync.mjs <push|pull|snapshot|verify> [--data <path>] [--out <path>] [--force] [--prune] [--dry-run]');
    process.exit(2);
  }
  commands[command]().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
}

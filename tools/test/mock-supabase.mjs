#!/usr/bin/env node
/* A stand-in for Supabase's REST API, so the PowerShell sync can be tested end to end
 * without a network or a real database. It implements only the calls the script makes:
 *
 *   POST   /rest/v1/<table>            upsert rows (merged by primary key)
 *   GET    /rest/v1/<table>?select=id  list ids            (app_documents: select=path)
 *   GET    /rest/v1/v_daily_totals     revenue per day
 *   DELETE /rest/v1/<table>?<filter>   prune
 *   GET    /health                     readiness probe
 *
 * Every request is echoed to stdout so a failing CI run says exactly what went wrong.
 * Usage: node mock-supabase.mjs [port]
 */
import http from 'node:http';

const PORT = Number(process.argv[2] || 8099);
const KEY_COLUMN = {app_documents: 'path', oct_batches: 'id'};
const scratch = {};   // table -> Map(key -> row)

function tableOf(name) {
  if (!scratch[name]) scratch[name] = new Map();
  return scratch[name];
}
const keyOf = (name, row) => row[KEY_COLUMN[name] || 'id'];

function json(res, code, body) {
  const text = JSON.stringify(body === undefined ? null : body);
  res.writeHead(code, {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text)});
  res.end(text);
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://127.0.0.1');
    console.log(`${req.method} ${url.pathname}${url.search}${body ? ' body=' + body.length + 'B' : ''}`);

    if (url.pathname === '/health') return json(res, 200, {ok: true});

    if (!req.headers.apikey || !req.headers.authorization) {
      console.log('  -> 401 missing apikey/authorization');
      return json(res, 401, {message: 'Missing auth'});
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'rest' || parts[1] !== 'v1') return json(res, 404, {message: 'Not found'});
    const name = parts[2];

    try {
      if (req.method === 'POST' && name !== 'v_daily_totals') {
        const rows = JSON.parse(body);
        const list = Array.isArray(rows) ? rows : [rows];
        const t = tableOf(name);
        for (const row of list) t.set(keyOf(name, row), row);
        console.log(`  -> 201 upserted ${list.length} into ${name} (now ${t.size})`);
        return json(res, 201, null);
      }

      if (req.method === 'DELETE') {
        const t = tableOf(name);
        const filter = decodeURIComponent(url.searchParams.toString() ? url.search.slice(1) : '');
        if (filter.includes('id=not.is.null')) { t.clear(); }
        else {
          const m = filter.match(/id=not\.in\.\((.*)\)$/);
          if (m) {
            const keep = new Set([...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
            for (const k of [...t.keys()]) if (!keep.has(k)) t.delete(k);
          }
        }
        console.log(`  -> 204 deleted, ${t.size} left in ${name}`);
        res.writeHead(204); return res.end();
      }

      if (req.method === 'GET' && name === 'v_daily_totals') {
        const byDay = new Map();
        for (const row of tableOf('sales').values()) {
          const day = new Date(Number(row.ts)).toISOString().slice(0, 10);
          const revenue = Number(row.qty) * Number(row.price);
          byDay.set(day, (byDay.get(day) || 0) + revenue);
        }
        const out = [...byDay.entries()].map(([day, revenue]) => ({day, revenue: revenue.toFixed(2)}));
        console.log(`  -> 200 v_daily_totals ${out.length} rows`);
        return json(res, 200, out);
      }

      if (req.method === 'GET') {
        const t = tableOf(name);
        const select = url.searchParams.get('select') || 'id';
        const out = [...t.values()].map(r => ({[select]: r[select]}));
        console.log(`  -> 200 ${name} ${out.length} rows`);
        return json(res, 200, out);
      }

      return json(res, 405, {message: 'Method not allowed'});
    } catch (e) {
      console.log('  -> 500', e.message);
      return json(res, 500, {message: e.message});
    }
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock supabase listening on http://127.0.0.1:${PORT}`));

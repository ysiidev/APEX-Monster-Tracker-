#!/usr/bin/env node
/* Preview server for the Monster Sales Tracker.
 *
 * Serves desktop/app/ as an ordinary web page so the UI can be inspected in a browser
 * without Windows, WebView2 or .NET. It is a preview harness only — it is NOT part of
 * the shipped app and the installers never package it.
 *
 * The page's CSP sets connect-src 'none', so the seed data cannot be fetched. Instead
 * index.html is served with one extra inline script that sets window.__APEX_SEED__
 * before bridge.js loads; bridge.js falls back to localStorage when it finds no
 * WebView2 host. Nothing on disk is modified.
 *
 * Usage:  node preview/server.js      then open http://localhost:8080/
 *         node preview/server.js 9090  (custom port)
 *         http://localhost:8080/?reset=1  clears the browser's preview data
 */
const http = require('http'), fs = require('fs'), path = require('path');

const APP = path.join(__dirname, '..', 'app');
const SNAPSHOT = path.join(APP, 'snapshot.json');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const HOST = '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function page(url) {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const seed = fs.readFileSync(SNAPSHOT, 'utf8');           // re-read each request so edits show up on reload
  const reset = url.searchParams.get('reset') === '1';
  const view = (url.searchParams.get('view') || 'tracker').replace(/[^a-z]/g, '');
  const inject =
    '<script>window.__APEX_SEED__=' + seed + ';' +
    (reset ? 'try{localStorage.clear();}catch(e){}' : '') +
    'window.__APEX_PREVIEW__=true;' +
    "try{if(!location.hash)location.hash='" + view + "';}catch(e){}</script>\n" +
    '<script src="bridge.js"></script>';
  if (!html.includes('<script src="bridge.js"></script>')) throw new Error('bridge.js tag not found in index.html');
  return html.replace('<script src="bridge.js"></script>', inject);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const send = (code, type, body) => {
    res.writeHead(code, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    res.end(body);
  };
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') return send(200, TYPES['.html'], page(url));

    const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\.])+/, '');
    const file = path.join(APP, rel);
    if (!file.startsWith(APP + path.sep)) return send(403, 'text/plain', 'Forbidden');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'text/plain', 'Not found');
    send(200, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', fs.readFileSync(file));
  } catch (e) {
    send(500, 'text/plain', 'Preview server error: ' + e.message);
  }
});

server.listen(PORT, HOST, () => {
  console.log('APEX Monster Sales Tracker — preview (not the Windows app)');
  console.log('  serving ' + APP);
  console.log('  http://localhost:' + PORT + '/          normal preview');
  console.log('  http://localhost:' + PORT + '/?reset=1  clear preview data, reload seed');
});

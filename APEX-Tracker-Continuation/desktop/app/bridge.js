(function () {
  'use strict';
  var pending = new Map(), nextId = 1, data, listeners = [], queue = Promise.resolve();

  /* Host detection. The Windows app injects window.chrome.webview; that path is used
     whenever it exists and is unchanged. When this page is served as a plain web page
     (the preview server, or a manual browser check) there is no host, so a
     localStorage-backed stand-in takes over and the app stays fully usable. */
  var host = (window.chrome && window.chrome.webview) || makeWebHost();

  function makeWebHost() {
    var KEY = 'apex-monster-preview-data', BAK = 'apex-monster-preview-backup', handlers = [];
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function load() {
      try { var raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {}
      var seed = window.__APEX_SEED__;
      if (!seed) throw new Error('No data source. Open the Windows app, or serve this page from the preview server.');
      try { localStorage.setItem(KEY, JSON.stringify(seed)); } catch (e) {}
      return clone(seed);
    }
    function csv(payload) {
      try {
        var blob = new Blob([payload.data], {type: 'text/csv'}), url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = payload.filename || 'export.csv';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        return true;
      } catch (e) { return false; }
    }
    return {
      addEventListener: function (type, fn) { if (type === 'message') handlers.push(fn); },
      postMessage: function (req) {
        var value = null;
        try {
          if (req.op === 'read') value = load();
          else if (req.op === 'write') { localStorage.setItem(KEY, JSON.stringify(req.value)); value = true; }
          else if (req.op === 'backup') { localStorage.setItem(BAK, localStorage.getItem(KEY) || JSON.stringify(load())); value = true; }
          else if (req.op === 'restore') { var raw = localStorage.getItem(BAK); if (raw) { localStorage.setItem(KEY, raw); value = JSON.parse(raw); } }
          else if (req.op === 'csv') value = csv(req.value);
          else throw new Error('Unknown operation: ' + req.op);
          setTimeout(function () { handlers.forEach(function (fn) { fn({data: {id: req.id, value: clone(value)}}); }); }, 0);
        } catch (e) {
          setTimeout(function () { handlers.forEach(function (fn) { fn({data: {id: req.id, error: e.message}}); }); }, 0);
        }
      }
    };
  }

  function call(op, value) {
    return new Promise(function (resolve, reject) {
      var id = nextId++; pending.set(id, {resolve:resolve, reject:reject});
      host.postMessage({id:id, op:op, value:value});
    });
  }
  host.addEventListener('message', function (event) {
    var r = event.data, p = pending.get(r.id); if (!p) return;
    pending.delete(r.id); if (r.error) p.reject(new Error(r.error)); else p.resolve(r.value);
  });
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function notify() { listeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); }
  function change(fn) {
    var work = queue.then(function () {
      var next = copy(data); var result = fn(next);
      return call('write', next).then(function () { data = next; notify(); return result; });
    });
    queue = work.catch(function () {}); return work;
  }
  function docSnapshot(obj, id) { return {id:id, exists:obj != null, data:function () { return copy(obj || {}); }}; }
  function doc(path, id) {
    return {
      onSnapshot:function (callback, onError) { var fn = function () { callback(docSnapshot(data[path], id)); }; listeners.push(fn); try { fn(); } catch(e) { if (onError) onError(e); } return function () { listeners = listeners.filter(function(x){return x!==fn;}); }; },
      set:function (obj) { return change(function (d) { d[path] = copy(obj); }); }
    };
  }
  function collection(name) {
    return {
      add:function (obj) { var id = 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); return change(function(d) { d[name].push(Object.assign({id:id}, copy(obj))); return {id:id}; }); },
      doc:function (id) { return {
        set:function(obj) { return change(function(d) { var i = d[name].findIndex(function(x){return x.id===id;}); if (i < 0) throw Error('Record not found'); d[name][i] = Object.assign({}, copy(obj), {id:id}); }); },
        update:function(obj) { return change(function(d) { var i = d[name].findIndex(function(x){return x.id===id;}); if (i < 0) throw Error('Record not found'); d[name][i] = Object.assign({}, d[name][i], copy(obj), {id:id}); }); },
        delete:function() { return change(function(d) { d[name] = d[name].filter(function(x){return x.id!==id;}); }); }
      }; },
      orderBy:function (field, direction) { return {limit:function (count) { return {onSnapshot:function(callback,onError) {
        var fn = function() { var items = data[name].slice().sort(function(a,b){ var av=a[field], bv=b[field]; return (av < bv ? -1 : av > bv ? 1 : 0) * (direction === 'desc' ? -1 : 1); }).slice(0,count); callback({docs:items.map(function(item){ var rec=copy(item); var id=rec.id; delete rec.id; return docSnapshot(rec,id); })}); };
        listeners.push(fn); try { fn(); } catch(e) { if(onError) onError(e); } return function(){listeners=listeners.filter(function(x){return x!==fn;});};
      }}; }}; }
    };
  }
  var db = {collection:collection, doc:function(path){return doc(path, path.split('/').pop());}};
  var ready = call('read').then(function(d) { data = d; return db; }).catch(function(e) {
    var b = document.getElementById('banner'); if(b){b.hidden=false; b.textContent='Could not open your local data: '+e.message+'. No data was reset. Close the app and check the data file.';} throw e;
  });
  window.claude = {use:function (name) { if(name === 'db') return ready; if(name === 'downloads') return Promise.resolve({save:function(o){return call('csv',o);}}); return Promise.resolve(null); }};
  document.addEventListener('DOMContentLoaded', function () {
    var status = document.getElementById('backup-status');
    document.getElementById('backup-data').onclick = function(){ queue.then(function(){return call('backup');}).then(function(x){status.textContent=x?'Backup saved.':'Backup cancelled.';}).catch(function(e){status.textContent='Backup failed: '+e.message;}); };
    document.getElementById('restore-data').onclick = function(){
      var work = queue.then(function(){return call('restore');}).then(function(x){if(x){data=x;notify();status.textContent='Backup restored.';} else status.textContent='Restore cancelled.';});
      queue=work.catch(function(){}); work.catch(function(e){status.textContent='Restore failed: '+e.message;});
    };
  });
})();

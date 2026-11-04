/* Public project key only. Access is enforced by Supabase RLS and the owner-only RPC.
 * Sessions stay in memory: reopening the app requires signing in again. */
(function () {
  'use strict';
  var URL_BASE = 'https://qbhigtwejckzvocrwaqb.supabase.co';
  var KEY = 'sb_publishable_ID0-dTZI4pQxefnWvhmmVQ_dj2p--4l';
  var EMAIL = 'mysidrareyes@gmail.com';
  var session = null, revision = null, busy = false, connected = false, applyRemote;
  function status(text) { ['cloud-status', 'login-message'].forEach(function (id) { var el = document.getElementById(id); if (el) el.textContent = text; }); }
  async function request(path, body, method) {
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 15000);
    try {
      var response = await fetch(URL_BASE + path, {method: method || (body ? 'POST' : 'GET'),
        headers: {apikey: KEY, Authorization: 'Bearer ' + (session ? session.access_token : KEY), 'Content-Type': 'application/json'},
        body: body ? JSON.stringify(body) : undefined, signal: controller.signal});
      var value = await response.json();
      if (!response.ok) throw Error(value.msg || value.message || value.error_description || 'Cloud request failed');
      return value;
    } finally { clearTimeout(timer); }
  }
  async function refresh() {
    if (!session) throw Error('Sign in to cloud first.');
    if (session.expires_at * 1000 < Date.now() + 60000) {
      session = await request('/auth/v1/token?grant_type=refresh_token', {refresh_token: session.refresh_token});
    }
  }
  async function read() {
    await refresh();
    var rows = await request('/rest/v1/tracker_live_state?id=eq.1&select=*');
    if (!rows.length) throw Error('This account does not have tracker access.');
    return rows[0];
  }
  window.ApexCloud = {
    active: function () { return connected; },
    attach: function (fn) { applyRemote = fn; },
    save: async function (payload) {
      if (busy) throw Error('Cloud sync in progress. Please try again.');
      busy = true; status('Saving to cloud…');
      try {
        await refresh();
        var rows = await request('/rest/v1/rpc/save_tracker_state', {expected_revision: revision, new_payload: payload});
        if (!rows.length) throw Error('Another device changed the tracker. Wait for refresh, then retry your change.');
        revision = rows[0].revision; status('Synced to cloud');
      } catch (e) { status('Not saved: ' + e.message); throw e; }
      finally { busy = false; }
    }
  };
  document.addEventListener('DOMContentLoaded', function () {
    var panel = document.createElement('section'); panel.id = 'staff-login';
    panel.setAttribute('aria-labelledby', 'portal-title');
    panel.innerHTML = '<div class="staff-card"><header class="staff-brand"><svg class="apex-mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M10 51 32 10 54 51M20 51 32 29 44 51"/><path class="cross" d="M18 42H46"/></svg><h1 id="portal-title">APEX Monster Tracker</h1><p>STAFF PORTAL</p></header>' +
      '<form id="cloud-password-controls"><h2>SIGN IN</h2><label for="cloud-email">USERNAME</label><input id="cloud-email" type="text" autocomplete="username" placeholder="admin" aria-label="Admin username" required>' +
      '<label for="cloud-password">PASSWORD</label><input id="cloud-password" type="password" autocomplete="current-password" placeholder="Password" required>' +
      '<p id="login-message" role="status" aria-live="polite"></p><button id="cloud-login" type="submit"><span>SIGN IN</span><svg class="signin-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M14 6l6 6-6 6"/></svg></button>' +
      '<button id="cloud-forgot" type="button">Forgot password?</button>' +
      '<details class="staff-setup"><summary>First-time account setup</summary><p>Use admin as your username and choose a tracker password. Confirm the account using your owner email before signing in.</p><button id="cloud-register" type="button">Create tracker account</button></details></form></div>';
    document.body.appendChild(panel);
    var toolbar = document.createElement('section'); toolbar.className = 'banner'; toolbar.id = 'cloud-toolbar';
    toolbar.innerHTML = '<span id="cloud-status" role="status">Sign in to connect.</span> <button id="cloud-out" type="button" hidden>Sign out</button>';
    document.querySelector('.wrap').prepend(toolbar);
    var out = document.getElementById('cloud-out');
    var password = document.getElementById('cloud-password');
    function toggleLogin(hidden) {
      document.documentElement.classList.toggle('staff-authenticated', hidden);
      panel.hidden = hidden;
      if (!hidden) document.getElementById('cloud-email').focus();
    }
    toggleLogin(false);
    async function finishLogin(value) {
      session = value;
      if (!session.user || session.user.email.toLowerCase() !== EMAIL) throw Error('Owner access required.');
      var row = await read();
      await applyRemote(row.payload, true);
      revision = row.revision; connected = true;
      password.value = '';
      toggleLogin(true); out.hidden = false; status('Synced to cloud');
    }
    async function passwordLogin(create) {
      if (busy) return;
      if (['admin', EMAIL].indexOf(document.getElementById('cloud-email').value.trim().toLowerCase()) === -1) { status('Use admin as your username.'); return; }
      if (!password.value) { status('Enter your tracker password, not your Gmail password.'); return; }
      if (create && password.value.length < 12) { status('Choose a new tracker password of at least 12 characters.'); return; }
      busy = true;
      document.getElementById('cloud-login').disabled = true;
      status(create ? 'Creating tracker account…' : 'Signing in…');
      var secret = password.value; password.value = '';
      try {
        if (create) {
          await request('/auth/v1/signup', {email: EMAIL, password: secret});
          status('Check your email and confirm your tracker account, then return here and sign in with your tracker password. If already registered, use Sign in.');
        } else {
          await finishLogin(await request('/auth/v1/token?grant_type=password', {email: EMAIL, password: secret}));
        }
      } catch (e) { session = null; status('Could not sign in: ' + e.message); }
      finally { secret = ''; busy = false; document.getElementById('cloud-login').disabled = false; }
    }
    document.getElementById('cloud-password-controls').onsubmit = function (event) { event.preventDefault(); return passwordLogin(false); };
    document.getElementById('cloud-register').onclick = function () { return passwordLogin(true); };
    document.getElementById('cloud-forgot').onclick = function () { status('Contact the portal administrator to reset your tracker password through Supabase Auth. Do not reset your Gmail password.'); };
    out.onclick = function () {
      if (busy) return;
      session = null; connected = false; revision = null; toggleLogin(false); password.value = '';
      out.hidden = true;
      status('Signed out. Sign in to access the tracker.');
    };
    setInterval(async function () {
      if (!connected || busy || document.hidden) return;
      busy = true;
      try {
        var row = await read();
        if (row.revision !== revision) { await applyRemote(row.payload, false); revision = row.revision; }
        status('Synced to cloud');
      } catch (e) { status('Cloud unavailable — changes require connection: ' + e.message); }
      finally { busy = false; }
    }, 5000);
  });
})();

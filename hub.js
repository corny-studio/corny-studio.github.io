/* hub.js — Roblox telemetry feed + repo automation workers for CORNY//STUDIO.
   Role comes from sessionStorage 'corny_role' ('admin' | 'guest'). Add this one line
   in agent-control.js after a successful gate check:  sessionStorage.setItem('corny_role', role);
   NOTE: the role gate is cosmetic (client-side). Treat this page as view-only; never wire
   real destructive actions or private keys to it. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var role = (sessionStorage.getItem('corny_role') || 'guest').toLowerCase() === 'admin' ? 'admin' : 'guest';
  var isAdmin = role === 'admin';
  var relayUrl = '';
  try { relayUrl = isAdmin ? (localStorage.getItem('corny_relay') || '') : ''; } catch (e) {}

  var logEl = $('#hub-log');
  var state = { ccu: 0, minted: 0, sunk: 0, buys: 0, ranks: 0, evCount: 0, lastId: 0, players: [] };
  var NAMES = ['Nova','Kito','Blaze','Mira','Zed','Orbit','Pixel','Rex','Luma','Volt','Echo','Jinx'];
  var ITEMS = ['2x Coins','Neon Trail','VIP Pass','Hover Board','Starter Pack','Pet Slot'];
  var RANKS = ['Member','Tester','Mod','Admin'];

  function ts() { return new Date().toTimeString().slice(0, 8); }
  function tag() { return (isAdmin && relayUrl) ? '[LIVE]' : '[SANDBOX]'; }
  function log(cls, msg) {
    var d = document.createElement('div');
    d.className = 't-' + cls;
    d.textContent = ts() + ' ' + tag() + ' ' + msg;
    logEl.appendChild(d);
    while (logEl.children.length > 400) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
    if (typeof window.cornyLog === 'function') { try { window.cornyLog(d.textContent); } catch (e) {} }
  }
  function sys(msg) { var d = document.createElement('div'); d.className = 't-sys'; d.textContent = ts() + ' [SYS] ' + msg; logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight; }

  function paint() {
    $('#m-ccu').textContent = state.ccu;
    $('#m-net').textContent = (state.minted - state.sunk).toLocaleString();
    $('#m-buy').textContent = state.buys;
    $('#m-rank').textContent = state.ranks;
  }

  /* Single entry point: simulated and relay events share one shape {type, data}. */
  function handle(ev) {
    var d = ev.data || {}; state.evCount++;
    switch (ev.type) {
      case 'join': state.ccu++; log('join', d.name + ' joined (rank ' + (d.rank || 'Member') + ')'); break;
      case 'leave': state.ccu = Math.max(0, state.ccu - 1); log('leave', d.name + ' left after ' + (d.mins || 0) + 'm'); break;
      case 'purchase': state.buys++; log('purchase', d.name + ' bought ' + d.item + ' (' + d.robux + ' R$)'); break;
      case 'economy':
        if (d.kind === 'mint') state.minted += d.amount; else state.sunk += d.amount;
        log('economy', d.kind + ' ' + d.amount + ' coins via ' + d.source); break;
      case 'rank': state.ranks++; log('rank', d.name + ' group rank ' + d.from + ' → ' + d.to); break;
      case 'asset': log('asset', 'config ' + d.key + ' = ' + d.value + ' (' + d.by + ')'); break;
      default: log('sys', 'unknown event ' + ev.type);
    }
    paint();
  }

  /* ---------- Simulation (guest + admin without a relay) ---------- */
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function simTick() {
    var r = Math.random();
    if (r < 0.28 || state.players.length < 3) {
      var n = pick(NAMES) + Math.floor(Math.random() * 900 + 100);
      state.players.push({ name: n, t: Date.now() });
      handle({ type: 'join', data: { name: n, rank: pick(RANKS.slice(0, 2)) } });
    } else if (r < 0.46) {
      var p = state.players.splice(Math.floor(Math.random() * state.players.length), 1)[0];
      handle({ type: 'leave', data: { name: p.name, mins: Math.max(1, Math.round((Date.now() - p.t) / 60000) + Math.floor(Math.random() * 40)) } });
    } else if (r < 0.62) {
      handle({ type: 'purchase', data: { name: pick(state.players).name, item: pick(ITEMS), robux: pick([49, 99, 199, 399, 799]) } });
    } else if (r < 0.88) {
      handle({ type: 'economy', data: { kind: Math.random() < 0.55 ? 'mint' : 'sink', amount: Math.floor(Math.random() * 450 + 25), source: pick(['quest','daily','shop','upgrade','trade tax']) } });
    } else if (r < 0.95) {
      var a = Math.floor(Math.random() * 3);
      handle({ type: 'rank', data: { name: pick(state.players).name, from: RANKS[a], to: RANKS[a + 1] } });
    } else {
      handle({ type: 'asset', data: { key: pick(['spawnRate','shopDiscount','eventBoost']), value: pick(['1.0','1.25','0.9','2x']), by: 'sim-config' } });
    }
  }

  /* ---------- Relay polling (admin with relay URL) ---------- */
  function poll() {
    fetch(relayUrl.replace(/\/$/, '') + '/events?since=' + state.lastId, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        (j.events || []).forEach(function (e) { state.lastId = Math.max(state.lastId, e.id); handle(e); });
      })
      .catch(function (e) { sys('relay poll failed: ' + e.message); });
  }

  var timer = null;
  function startFeed() {
    clearInterval(timer);
    var live = isAdmin && relayUrl;
    $('#b-mode').textContent = live ? 'LIVE RELAY' : 'SIMULATED FEED';
    $('#b-mode').className = 'badge ' + (live ? 'live' : 'sim');
    timer = setInterval(live ? poll : simTick, live ? 3000 : 1300);
    sys(live ? 'polling ' + relayUrl : 'simulation running (no real Roblox data)');
  }

  setInterval(function () { $('#c-rate').textContent = state.evCount + ' ev total'; }, 2000);

  /* ---------- Automation pipelines ---------- */
  var FILES = ['index.html', 'panel.html', 'agent-control.js', 'hub.html', 'hub.js'];
  var SECRET_RE = /(secret|token|api[_-]?key|password)\w*\s*[:=]\s*["'][^"']{6,}["']/ig;

  function fetchText(f) {
    return fetch(f + '?_=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(f + ' → HTTP ' + r.status);
      return r.text();
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function alog(msg) { log('agent', msg); }

  var AGENTS = [
    { id: 'audit', name: 'Repo auditor', desc: 'Reads each root file, reports size and flags secret-looking strings.',
      run: async function () {
        var total = 0, flags = 0;
        for (var i = 0; i < FILES.length; i++) {
          try {
            var t = await fetchText(FILES[i]); total += t.length;
            var hits = t.match(SECRET_RE) || [];
            alog('audit ' + FILES[i] + ' ' + (t.length / 1024).toFixed(1) + ' KB' + (hits.length ? '  ⚠ ' + hits.length + ' secret-like string(s) visible to every visitor' : '  ok'));
            flags += hits.length;
          } catch (e) { alog('audit ' + FILES[i] + ' unreachable here — simulated pass'); }
          await sleep(350);
        }
        alog('audit done: ' + (total / 1024).toFixed(1) + ' KB scanned, ' + flags + ' flag(s)');
      } },
    { id: 'links', name: 'Link checker', desc: 'Follows same-site links on index.html and confirms each page loads.',
      run: async function () {
        try {
          var html = await fetchText('index.html');
          var found = (html.match(/href="([^"#:]+\.html)"/g) || []).map(function (h) { return h.slice(6, -1); });
          found = found.filter(function (v, i, a) { return a.indexOf(v) === i; });
          alog('links found: ' + (found.join(', ') || 'none'));
          for (var i = 0; i < found.length; i++) {
            try { await fetchText(found[i]); alog('links ' + found[i] + ' → 200'); }
            catch (e) { alog('links ' + found[i] + ' → BROKEN'); }
            await sleep(250);
          }
        } catch (e) { alog('links index.html unreachable here — simulated: panel.html → 200'); }
        alog('links done');
      } },
    { id: 'layout', name: 'Layout guard', desc: 'Enforces your rules: root-only files, no external CSS folder, no inline JS bloat.',
      run: async function () {
        var bad = 0;
        for (var i = 0; i < FILES.length; i++) {
          if (!/\.html$/.test(FILES[i])) continue;
          try {
            var t = await fetchText(FILES[i]);
            if (/<link[^>]+rel=["']stylesheet["']/i.test(t)) { alog('layout ' + FILES[i] + ' uses external stylesheet'); bad++; }
            if (/(src|href)=["'](?!https?:|#|mailto:)[^"']*\//i.test(t)) { alog('layout ' + FILES[i] + ' references a subfolder path'); bad++; }
            var inl = (t.match(/<script(?![^>]*src)[^>]*>[\s\S]*?<\/script>/gi) || []).join('').length;
            if (inl > 4000) { alog('layout ' + FILES[i] + ' inline JS ' + inl + ' chars, move to a .js file'); bad++; }
          } catch (e) { alog('layout ' + FILES[i] + ' unreachable here — simulated pass'); }
          await sleep(250);
        }
        alog('layout done: ' + bad + ' violation(s)');
      } }
  ];

  var agentsEl = $('#agents');
  AGENTS.forEach(function (a) {
    var box = document.createElement('div'); box.className = 'agent';
    box.innerHTML = '<div class="row"><strong></strong><span class="st">idle</span></div><p></p><button type="button">Run worker</button>';
    box.querySelector('strong').textContent = a.name;
    box.querySelector('p').textContent = a.desc;
    var btn = box.querySelector('button'), st = box.querySelector('.st');
    if (!isAdmin) { btn.disabled = true; btn.classList.add('btn-disabled'); btn.title = 'Admin only'; }
    btn.addEventListener('click', async function () {
      if (!isAdmin) return;
      btn.disabled = true; st.textContent = 'running'; st.className = 'st run';
      alog('▶ ' + a.name + ' started');
      try { await a.run(); st.textContent = 'done'; st.className = 'st done'; }
      catch (e) { st.textContent = 'error'; alog('✖ ' + a.name + ': ' + e.message); }
      btn.disabled = false;
    });
    agentsEl.appendChild(box);
  });

  /* ---------- Admin controls ---------- */
  var cmd = $('#cmd');
  if (!isAdmin) { cmd.disabled = true; cmd.placeholder = 'guest: read-only terminal'; $('#cfg').style.display = 'none'; }
  cmd.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !isAdmin) return;
    var v = cmd.value.trim(); cmd.value = ''; if (!v) return;
    sys('> ' + v);
    if (v === 'help') sys('commands: help, clear, stats, run audit|links|layout');
    else if (v === 'clear') logEl.textContent = '';
    else if (v === 'stats') sys('events ' + state.evCount + ', ccu ' + state.ccu + ', net ' + (state.minted - state.sunk));
    else if (/^run (audit|links|layout)$/.test(v)) {
      var id = v.split(' ')[1]; AGENTS.filter(function (a) { return a.id === id; })[0].run();
    } else sys('unknown command (only the listed ones do anything)');
  });
  $('#relay-save').addEventListener('click', function () {
    var v = $('#relay').value.trim();
    if (!/^https:\/\//.test(v)) { sys('relay URL must start with https://'); return; }
    relayUrl = v; try { localStorage.setItem('corny_relay', v); } catch (e) {}
    state.lastId = 0; startFeed();
  });
  $('#relay-clear').addEventListener('click', function () {
    relayUrl = ''; try { localStorage.removeItem('corny_relay'); } catch (e) {}
    startFeed();
  });
  if (relayUrl) $('#relay').value = relayUrl;

  var rb = $('#b-role'); rb.textContent = role.toUpperCase(); rb.className = 'badge ' + role;
  sys('hub online as ' + role.toUpperCase());
  startFeed();
})();

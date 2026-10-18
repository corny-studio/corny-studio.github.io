/* agents.js — Roblox Agents control room (master only).
   Board, log and announcements are saved on your Worker (locked behind your master key);
   with no relay set they are saved in this browser only. Nothing here publishes by itself:
   every outward action (Discord post, status change) needs your click. */
(function () {
  "use strict";

  var cfg = window.CORNY_CONFIG || {};
  var RELAY = (cfg.relayUrl || "").replace(/\/$/, "");
  var GROUP = cfg.robloxGroupId || "";
  var STATUSES = ["Idea", "Building", "Testing", "Ready", "Published"];
  var LOCAL_KEY = "corny_board";
  var FILES = ["index.html", "market.html", "panel.html", "hub.html", "agents.html",
               "config.js", "auth.js", "agent-control.js", "market.js", "script.js", "hub.js", "agents.js"];
  var SECRET_RE = /(secret|token|api[_-]?key|password)\w*\s*[:=]\s*["'][^"']{6,}["']/ig;

  /* ================= Pure helpers (also used by tests) ================= */
  var Lib = {
    buildIdeaPrompt: function (items) {
      var shipped = items.filter(function (i) { return i.status === "Published"; }).slice(0, 5)
        .map(function (i) { return "- " + i.title; });
      var open = items.filter(function (i) { return i.status !== "Published"; }).slice(0, 8)
        .map(function (i) { return "- [" + i.status + "] " + i.title; });
      return [
        "I'm a solo Roblox developer. Help me brainstorm 5 new feature ideas for my game.",
        "",
        "Already shipped:",
        shipped.length ? shipped.join("\n") : "- (nothing logged yet)",
        "",
        "Already on my board:",
        open.length ? open.join("\n") : "- (empty)",
        "",
        "For each idea give: a one-line pitch, why players would like it, how hard it is to build (easy / medium / hard), and the main risk. Don't repeat anything that's already shipped or on my board."
      ].join("\n");
    },

    buildBuildPrompt: function (item) {
      return [
        "I'm building a Roblox feature. Write the Luau code for it.",
        "",
        "Feature: " + item.title,
        "Details: " + (item.notes || "(none)"),
        "",
        "Requirements:",
        "- Server-authoritative: validate every RemoteEvent on the server and never trust the client.",
        "- Use ModuleScripts with clear names; add comments only where they help.",
        "- Report coin changes with game.ServerStorage.EconomyLog:Fire(\"mint\" or \"sink\", amount, source).",
        "- Tell me exactly which script goes where (ServerScriptService, ReplicatedStorage, StarterPlayerScripts).",
        "- Finish with a short checklist for testing it in Studio before I publish."
      ].join("\n");
    },

    buildAnnouncement: function (item, groupId) {
      var lines = ["**Update: " + item.title + "**"];
      var notes = (item.notes || "").trim().slice(0, 400);
      if (notes) { lines.push(""); lines.push(notes); }
      if (groupId) { lines.push(""); lines.push("Join the community: https://www.roblox.com/groups/" + groupId); }
      return lines.join("\n");
    },

    buildChangelog: function (items) {
      var pub = items.filter(function (i) { return i.status === "Published"; })
        .sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
      if (!pub.length) return "No published updates yet.";
      return ["# Changelog", ""].concat(pub.map(function (i) {
        var d = new Date(i.updated || i.created || Date.now()).toISOString().slice(0, 10);
        var n = (i.notes || "").replace(/\s+/g, " ").slice(0, 160);
        return "- **" + i.title + "**" + (n ? " — " + n : "") + " (" + d + ")";
      })).join("\n");
    },

    analyze: function (events) {
      var n = events.length, c = { join: 0, leave: 0, purchase: 0, economy: 0, rank: 0 };
      var minted = 0, sunk = 0, robux = 0, mins = 0, minsN = 0;
      events.forEach(function (e) {
        var d = e.data || {};
        if (c[e.type] !== undefined) c[e.type]++;
        if (e.type === "economy") {
          if (d.kind === "mint") minted += Number(d.amount) || 0;
          else if (d.kind === "sink") sunk += Number(d.amount) || 0;
        }
        if (e.type === "purchase") robux += Number(d.robux) || 0;
        if (e.type === "leave" && typeof d.mins === "number") { mins += d.mins; minsN++; }
      });
      var f = [];
      if (n === 0) f.push("No Roblox events received yet. Connect the Telemetry script first.");
      else if (n < 30) f.push("Only " + n + " events so far, which is too few to judge. Check again with more players.");
      else {
        if (minted >= 500 && minted > sunk * 1.5) f.push("Coins minted (" + minted + ") are well above coins sunk (" + sunk + "). Inflation risk: add coin sinks or lower rewards.");
        if (sunk >= 500 && sunk > minted * 1.5) f.push("Coins sunk (" + sunk + ") are well above coins minted (" + minted + "). Players may feel starved: check prices and rewards.");
        if (c.join >= 10 && c.purchase === 0) f.push("No purchases across " + c.join + " joins. Check that shop items are visible and fairly priced.");
        if (minsN >= 5 && mins / minsN < 3) f.push("Players leave after " + (mins / minsN).toFixed(1) + " minutes on average. Check the first minute of the experience.");
        if (!f.length) f.push("No clear problems in the last " + n + " events.");
      }
      return { events: n, counts: c, minted: minted, sunk: sunk, robux: robux, avgMins: minsN ? mins / minsN : null, findings: f };
    }
  };
  window.AgentsLib = Lib;

  /* ================= DOM helpers ================= */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function now() { return new Date().toTimeString().slice(0, 8); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function isAdmin() { return !!(window.Auth && window.Auth.isAdmin()); }

  var toastTimer = null;
  function toast(msg, bad) {
    var t = $("toast");
    t.textContent = msg; t.className = bad ? "bad" : ""; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 4000);
  }

  function copyText(text, okMsg) {
    function done(ok) { toast(ok ? okMsg : "Copy failed. Select the text and copy it manually.", !ok); }
    function fallback() {
      var t = document.createElement("textarea");
      t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(t); done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else { fallback(); }
  }

  /* ================= Storage: Worker (synced) or this browser ================= */
  var board = { items: [], log: [], announce: false };
  var remote = !!RELAY;

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function api(method, path, body) {
    var opts = { method: method, headers: { "X-Admin-Key": window.Auth.key() }, cache: "no-store" };
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(RELAY + path, opts).then(function (r) {
      if (r.status === 403) throw new Error("Not authorized. Log in again.");
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ("HTTP " + r.status)); });
      var ct = r.headers.get("content-type") || "";
      return ct.indexOf("json") > -1 ? r.json() : r.text();
    });
  }

  function localRead() {
    try {
      var b = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
      if (b && Array.isArray(b.items) && Array.isArray(b.log)) return b;
    } catch (e) {}
    return { items: [], log: [] };
  }
  function localWrite(b) {
    b.items = b.items.slice(0, 200); b.log = b.log.slice(-300);
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(b)); } catch (e) {}
  }
  function localLog(b, agent, msg) { b.log.push({ t: Date.now(), agent: agent, msg: String(msg).slice(0, 300) }); }

  var Store = {
    load: function () {
      if (remote) return api("GET", "/board").then(function (j) { board = { items: j.items || [], log: j.log || [], announce: !!j.announce }; });
      var b = localRead(); board = { items: b.items, log: b.log, announce: false };
      return Promise.resolve();
    },
    add: function (title, notes) {
      if (remote) return api("POST", "/board/item", { title: title, notes: notes });
      var b = localRead(), t = Date.now();
      b.items.unshift({ id: uid(), title: title, notes: notes, status: "Idea", created: t, updated: t });
      localLog(b, "Idea", "Added idea: " + title); localWrite(b);
      return Promise.resolve();
    },
    setStatus: function (id, status) {
      if (remote) return api("POST", "/board/update", { id: id, status: status });
      var b = localRead(), it = b.items.filter(function (i) { return i.id === id; })[0];
      if (it && it.status !== status) { localLog(b, "Library", '"' + it.title + '" moved ' + it.status + " -> " + status); it.status = status; it.updated = Date.now(); localWrite(b); }
      return Promise.resolve();
    },
    remove: function (id) {
      if (remote) return api("DELETE", "/board/item?id=" + encodeURIComponent(id));
      var b = localRead(), idx = -1;
      b.items.forEach(function (i, n) { if (i.id === id) idx = n; });
      if (idx > -1) { localLog(b, "Library", "Deleted: " + b.items[idx].title); b.items.splice(idx, 1); localWrite(b); }
      return Promise.resolve();
    },
    log: function (agent, msg) {
      if (remote) return api("POST", "/board/log", { agent: agent, msg: msg }).catch(function () {});
      var b = localRead(); localLog(b, agent, msg); localWrite(b);
      return Promise.resolve();
    }
  };

  /* ================= Roster (Team tab) ================= */
  var AGENTS = [
    { id: "idea", name: "Idea Agent", role: "Keeps the idea board and writes brainstorm prompts", kind: "board" },
    { id: "builder", name: "Builder Agent", role: "Turns an item into a ready-made build prompt", kind: "board" },
    { id: "library", name: "Library Agent", role: "Keeps the log and changelog", kind: "board" },
    { id: "analyst", name: "Analyst Agent", role: "Flags problems in your live Roblox events", kind: "board" },
    { id: "announcer", name: "Announcer Agent", role: "Drafts Discord updates; posts only after you accept", kind: "board" },
    { id: "audit", name: "Repo Auditor", role: "Scans site files for size and secret-looking strings", kind: "worker", run: runAudit },
    { id: "links", name: "Link Checker", role: "Confirms internal pages load", kind: "worker", run: runLinks },
    { id: "layout", name: "Layout Guard", role: "Root-only files, no external CSS, small inline scripts", kind: "worker", run: runLayout },
    { id: "telemetry", name: "Telemetry", role: "Reads live Roblox events from your relay", kind: "live" },
    { id: "group", name: "Group Monitor", role: "Tracks your Roblox community member count", kind: "live" },
    { id: "market", name: "Market Manager", role: "Counts published market items", kind: "live" },
    { id: "aibuilder", name: "AI Builder", role: "Planned: writes code itself (needs an AI API account)", kind: "planned" },
    { id: "publisher", name: "Publisher", role: "Planned: pushes game updates (needs a build pipeline; you publish in Studio for now)", kind: "planned" }
  ];
  var state = {};
  AGENTS.forEach(function (a) {
    state[a.id] = a.kind === "planned" ? { status: "planned", detail: "Not built yet" }
                : a.kind === "worker" ? { status: "idle", detail: "Not run yet" }
                :                       { status: "idle", detail: "Checking..." };
  });

  function setAgent(id, status, detail) { state[id] = { status: status, detail: detail }; renderRoster(); }

  function updateBoardAgents() {
    function count(s) { return board.items.filter(function (i) { return i.status === s; }).length; }
    var ideas = count("Idea"), building = count("Building");
    var ready = count("Ready") + count("Published");
    state.idea = { status: ideas ? "active" : "idle", detail: ideas + " idea" + (ideas === 1 ? "" : "s") + " waiting" };
    state.builder = { status: building ? "active" : "idle", detail: building + " item" + (building === 1 ? "" : "s") + " in Building" };
    state.library = { status: "active", detail: board.log.length + " log entries · " + count("Published") + " published" };
    if (state.analyst.detail === "Checking...") state.analyst = { status: "idle", detail: "Not run yet" };
    if (remote) state.announcer = board.announce ? { status: "active", detail: "Discord webhook ready · " + ready + " item(s) ready to announce" }
                                                 : { status: "offline", detail: "Add DISCORD_WEBHOOK secret to the Worker" };
    else state.announcer = { status: "offline", detail: "Needs relayUrl in config.js and a Discord webhook" };
  }

  function renderRoster() {
    var box = $("roster");
    box.textContent = "";
    var counts = { working: 0, active: 0, offline: 0, planned: 0 };
    AGENTS.forEach(function (a) {
      var s = state[a.id];
      if (counts[s.status] !== undefined) counts[s.status]++;
      var row = el("div", "agent " + s.status);
      row.appendChild(el("span", "dot"));
      var info = el("div", "info");
      info.appendChild(el("strong", "", a.name));
      info.appendChild(el("span", "role", a.role));
      info.appendChild(el("span", "detail", s.detail));
      row.appendChild(info);
      row.appendChild(el("span", "pill", s.status));
      if (a.kind === "worker") {
        var b = el("button", "act", "Run"); b.type = "button";
        b.disabled = s.status === "working";
        b.addEventListener("click", function () { runWorker(a); });
        row.appendChild(b);
      } else { row.appendChild(el("span", "spacer")); }
      box.appendChild(row);
    });
    $("cnt-working").textContent = counts.working + " working";
    $("cnt-active").textContent = counts.active + " active";
    $("cnt-offline").textContent = counts.offline + " offline";
    $("cnt-planned").textContent = counts.planned + " planned";
  }

  /* ================= Live agents (real relay data) ================= */
  function ago(ms) {
    var m = Math.floor((Date.now() - ms) / 60000);
    if (m < 1) return "just now"; if (m < 60) return m + "m ago";
    if (m < 1440) return Math.floor(m / 60) + "h ago"; return Math.floor(m / 1440) + "d ago";
  }
  function getJson(path) {
    return fetch(RELAY + path, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }

  function refreshLive() {
    if (!RELAY) {
      ["telemetry", "group", "market"].forEach(function (id) { state[id] = { status: "offline", detail: "Set relayUrl in config.js" }; });
      renderRoster(); return;
    }
    getJson("/events?since=0").then(function (j) {
      var ev = j.events || [];
      if (!ev.length) return setAgent("telemetry", "idle", "Relay connected, no Roblox events yet");
      var last = ev[ev.length - 1];
      setAgent("telemetry", Date.now() - last.t < 300000 ? "active" : "idle", ev.length + " recent events · last " + ago(last.t));
    }).catch(function (e) { setAgent("telemetry", "offline", "Relay unreachable (" + e.message + ")"); });

    if (!/^\d{1,12}$/.test(GROUP)) setAgent("group", "offline", "Set robloxGroupId in config.js");
    else getJson("/group?id=" + GROUP).then(function (j) {
      if (typeof j.memberCount === "number") setAgent("group", "active", j.memberCount.toLocaleString() + " members" + (j.name ? " · " + j.name : ""));
      else setAgent("group", "offline", "Roblox returned no data");
    }).catch(function (e) { setAgent("group", "offline", "Relay unreachable (" + e.message + ")"); });

    getJson("/market").then(function (j) {
      var n = (j.items || []).length;
      setAgent("market", "active", n + " published item" + (n === 1 ? "" : "s"));
    }).catch(function (e) { setAgent("market", "offline", "Relay unreachable (" + e.message + ")"); });
  }

  /* ================= Reviewer workers (real checks on your files) ================= */
  function read(f) {
    return fetch(f + "?_=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  async function runWorker(a) {
    setAgent(a.id, "working", "Running...");
    try {
      var result = await a.run();
      setAgent(a.id, "idle", "Last run " + now() + " · " + result);
      Store.log("Reviewer", a.name + ": " + result).then(refreshBoard);
    } catch (e) {
      setAgent(a.id, "idle", "Last run failed: " + e.message);
      toast(a.name + " failed: " + e.message, true);
    }
  }

  async function runAudit() {
    var total = 0, flags = 0, missing = 0;
    for (var i = 0; i < FILES.length; i++) {
      try {
        var t = await read(FILES[i]); total += t.length;
        flags += (t.match(SECRET_RE) || []).filter(function (h) { return !/CHANGE_ME/.test(h); }).length;
      } catch (e) { missing++; }
      await sleep(100);
    }
    return (FILES.length - missing) + " files · " + (total / 1024).toFixed(0) + " KB · " + flags + " secret-like flag(s)" + (missing ? " · " + missing + " unreadable" : "");
  }

  async function runLinks() {
    var pages = ["index.html", "market.html", "panel.html", "hub.html", "agents.html"], seen = {}, broken = 0, checked = 0;
    for (var i = 0; i < pages.length; i++) {
      var html;
      try { html = await read(pages[i]); } catch (e) { broken++; continue; }
      var re = /href="([^"#:?]+\.html)"/g, m;
      while ((m = re.exec(html))) {
        if (seen[m[1]]) continue; seen[m[1]] = true;
        try { await read(m[1]); } catch (e) { broken++; }
        checked++; await sleep(80);
      }
    }
    return checked + " links checked · " + broken + " broken";
  }

  async function runLayout() {
    var bad = 0, scanned = 0;
    for (var i = 0; i < FILES.length; i++) {
      if (!/\.html$/.test(FILES[i])) continue;
      try {
        var t = await read(FILES[i]); scanned++;
        if (/<link[^>]+rel=["']stylesheet["']/i.test(t)) bad++;
        if (/(src|href)=["'](?!https?:|#|mailto:)[^"']*\//i.test(t)) bad++;
        if ((t.match(/<script(?![^>]*src)[^>]*>[\s\S]*?<\/script>/gi) || []).join("").length > 4000) bad++;
      } catch (e) {}
      await sleep(80);
    }
    return scanned + " pages scanned · " + bad + " violation(s)";
  }

  /* ================= Board tab ================= */
  function refreshBoard() {
    return Store.load().then(function () { updateBoardAgents(); renderAll(); })
      .catch(function (e) { toast("Board: " + e.message, true); });
  }

  function act(promise, okMsg) {
    return promise.then(refreshBoard).then(function () { if (okMsg) toast(okMsg); })
      .catch(function (e) { toast(e.message, true); });
  }

  function mkBtn(label, title, fn, cls) {
    var b = el("button", cls || "", label); b.type = "button";
    b.title = title; b.setAttribute("aria-label", title);
    b.addEventListener("click", fn);
    return b;
  }

  function boardCard(it, col) {
    var c = el("div", "bcard");
    c.appendChild(el("strong", "", it.title));
    if (it.notes) c.appendChild(el("p", "", it.notes));
    var row = el("div", "brow");
    if (col > 0) row.appendChild(mkBtn("◀", "Move to " + STATUSES[col - 1], function () { act(Store.setStatus(it.id, STATUSES[col - 1])); }));
    if (col < STATUSES.length - 1) row.appendChild(mkBtn("▶", "Move to " + STATUSES[col + 1], function () { act(Store.setStatus(it.id, STATUSES[col + 1])); }));
    if (it.status === "Idea" || it.status === "Building") {
      row.appendChild(mkBtn("Prompt", "Copy a build prompt for this item", function () { copyText(Lib.buildBuildPrompt(it), "Build prompt copied. Paste it into your chat."); }));
    }
    row.appendChild(mkBtn("✕", "Delete this item", function () { if (confirm('Delete "' + it.title + '"?')) act(Store.remove(it.id)); }, "danger"));
    c.appendChild(row);
    return c;
  }

  function renderBoard() {
    $("board-note").textContent = remote
      ? "Saved on your Worker, locked behind your master key. Works from any device."
      : "Saved in this browser only. Set relayUrl in config.js to sync across devices.";
    var wrap = $("columns");
    wrap.textContent = "";
    STATUSES.forEach(function (st, col) {
      var list = board.items.filter(function (i) { return i.status === st; });
      var c = el("div", "col");
      c.appendChild(el("h3", "", st + " (" + list.length + ")"));
      list.forEach(function (it) { c.appendChild(boardCard(it, col)); });
      wrap.appendChild(c);
    });
  }

  /* ================= Analyst tab ================= */
  function renderAnalyst(r) {
    var out = $("analyst-out");
    out.textContent = "";
    var stats = el("div", "stats");
    [["Events read", r.events], ["Joins", r.counts.join], ["Purchases", r.counts.purchase],
     ["Robux seen", r.robux], ["Coins minted", r.minted], ["Coins sunk", r.sunk],
     ["Avg minutes played", r.avgMins === null ? "n/a" : r.avgMins.toFixed(1)]].forEach(function (s) {
      var d = el("div", "stat"); d.appendChild(el("b", "", String(s[1]))); d.appendChild(el("small", "", s[0])); stats.appendChild(d);
    });
    out.appendChild(stats);
    r.findings.forEach(function (text) {
      var f = el("div", "finding"); f.appendChild(el("span", "", text));
      f.appendChild(mkBtn("Add to board", "Add this finding to the board as an idea", function () {
        act(Store.add("Investigate: " + text.slice(0, 85), text), "Added to the board.");
      }, "act"));
      out.appendChild(f);
    });
  }

  function runAnalyst() {
    if (!RELAY) { toast("Set relayUrl in config.js first. The analyst reads your relay.", true); return; }
    var btn = $("analyst-run"); btn.disabled = true; setAgent("analyst", "working", "Reading events...");
    getJson("/events?since=0").then(function (j) {
      var r = Lib.analyze(j.events || []);
      renderAnalyst(r);
      setAgent("analyst", "idle", "Last run " + now() + " · " + r.events + " events, " + r.findings.length + " finding(s)");
      Store.log("Analyst", "Read " + r.events + " events: " + r.findings[0].slice(0, 120)).then(refreshBoard);
    }).catch(function (e) { setAgent("analyst", "offline", "Relay unreachable (" + e.message + ")"); toast("Analyst: " + e.message, true); })
      .then(function () { btn.disabled = false; });
  }

  /* ================= Announcer tab ================= */
  function renderAnnounce() {
    var sel = $("ann-item"), keep = sel.value;
    sel.textContent = "";
    var items = board.items.filter(function (i) { return i.status === "Ready" || i.status === "Published"; });
    if (!items.length) { var o = el("option", "", "No Ready or Published items yet"); o.value = ""; sel.appendChild(o); }
    items.forEach(function (i) { var o = el("option", "", "[" + i.status + "] " + i.title); o.value = i.id; sel.appendChild(o); });
    if (keep) sel.value = keep;
    $("ann-note").textContent = remote
      ? (board.announce ? "Discord webhook is ready. Posting needs your click." : "Posting is off: add a DISCORD_WEBHOOK secret to your Worker.")
      : "Posting is off: set relayUrl in config.js and a DISCORD_WEBHOOK secret. You can still draft and copy.";
    $("ann-post").disabled = !(remote && board.announce);
  }

  function draftAnnouncement() {
    var id = $("ann-item").value;
    var it = board.items.filter(function (i) { return i.id === id; })[0];
    if (!it) { toast("Pick an item first.", true); return; }
    $("ann-text").value = Lib.buildAnnouncement(it, GROUP);
  }

  function postAnnouncement() {
    var text = $("ann-text").value.trim();
    if (!text) { toast("Nothing to post.", true); return; }
    if (!confirm("Post this to Discord now?")) return;
    var btn = $("ann-post"); btn.disabled = true;
    var id = $("ann-item").value;
    var it = board.items.filter(function (i) { return i.id === id; })[0];
    api("POST", "/announce", { text: text }).then(function () {
      toast("Posted to Discord.");
      if (it && it.status === "Ready") return Store.setStatus(it.id, "Published");
    }).then(refreshBoard).catch(function (e) { toast(e.message, true); }).then(function () { renderAnnounce(); });
  }

  /* ================= Library tab ================= */
  function renderLibrary() {
    var box = $("log-list");
    box.textContent = "";
    if (!board.log.length) { box.appendChild(el("p", "empty", "Nothing logged yet.")); return; }
    board.log.slice().reverse().forEach(function (e) {
      var d = el("div", "");
      d.appendChild(el("span", "t", new Date(e.t).toLocaleString()));
      d.appendChild(el("span", "ag", e.agent));
      d.appendChild(document.createTextNode(e.msg));
      box.appendChild(d);
    });
  }

  /* ================= Wiring ================= */
  function renderAll() { renderRoster(); renderBoard(); renderAnnounce(); renderLibrary(); }

  function showTab(name) {
    ["team", "board", "analyst", "announce", "library"].forEach(function (t) { $("tab-" + t).hidden = t !== name; });
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === name); });
  }

  function addIdea() {
    var t = $("idea-title").value.trim().slice(0, 100), n = $("idea-notes").value.trim().slice(0, 800);
    if (!t) { toast("Give the idea a title.", true); return; }
    act(Store.add(t, n), "Idea added.").then(function () { $("idea-title").value = ""; $("idea-notes").value = ""; });
  }

  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
    b.addEventListener("click", function () { showTab(b.getAttribute("data-tab")); });
  });
  $("idea-add").addEventListener("click", addIdea);
  $("idea-title").addEventListener("keydown", function (e) { if (e.key === "Enter") addIdea(); });
  $("brainstorm-btn").addEventListener("click", function () { copyText(Lib.buildIdeaPrompt(board.items), "Brainstorm prompt copied. Paste it into your chat."); });
  $("analyst-run").addEventListener("click", runAnalyst);
  $("ann-draft").addEventListener("click", draftAnnouncement);
  $("ann-post").addEventListener("click", postAnnouncement);
  $("ann-copy").addEventListener("click", function () { copyText($("ann-text").value, "Announcement copied."); });
  $("changelog-copy").addEventListener("click", function () { copyText(Lib.buildChangelog(board.items), "Changelog copied."); });

  var timer = null;
  function sync() {
    var admin = isAdmin();
    $("locked").hidden = admin;
    $("app").hidden = !admin;
    clearInterval(timer);
    if (admin) {
      renderAll(); refreshLive(); refreshBoard();
      timer = setInterval(function () { if (!document.hidden) { refreshLive(); refreshBoard(); } }, 30000);
    } else {
      board = { items: [], log: [], announce: false };
    }
  }

  window.addEventListener("corny-auth", sync);
  sync();
})();

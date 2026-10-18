/* agents.js — Roblox Agents chat (master only).
   Talk to your agents in channels and use slash commands (type "/" to see them).
   Board, log and Discord posting live on your Worker, locked behind your master key
   (browser-only if no relay is set). Chat history is kept for this tab only.
   Agents follow slash commands. If you add AI provider keys to your Worker (Claude, GPT, Gemini), free text
   in a channel goes to that channel's AI; /ask, /council and /build use them too. Keys never leave the Worker.
   Nothing publishes by itself: every outward action (Discord post) needs your Accept click. */
(function () {
  "use strict";

  var cfg = window.CORNY_CONFIG || {};
  var RELAY = (cfg.relayUrl || "").replace(/\/$/, "");
  var GROUP = cfg.robloxGroupId || "";
  var STATUSES = ["Idea", "Building", "Testing", "Ready", "Published"];
  var LOCAL_KEY = "corny_board";
  var MSG_PREFIX = "corny_chat_";
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
    },

    /* "/name rest of the line" -> { name, args } ; null if not a command */
    parseCommand: function (raw) {
      raw = (raw || "").trim();
      if (raw.charAt(0) !== "/") return null;
      var m = /^\/(\S*)\s*([\s\S]*)$/.exec(raw);
      return { name: m[1].toLowerCase(), args: m[2].trim() };
    },

    /* "Title | notes" */
    splitIdea: function (args) {
      var i = args.indexOf("|");
      if (i === -1) return { title: args.trim().slice(0, 100), notes: "" };
      return { title: args.slice(0, i).trim().slice(0, 100), notes: args.slice(i + 1).trim().slice(0, 800) };
    },

    /* "<ref> <status>" with the status as the last word */
    parseMove: function (args) {
      var a = (args || "").trim(), low = a.toLowerCase();
      for (var i = 0; i < STATUSES.length; i++) {
        var s = STATUSES[i].toLowerCase();
        if (low === s) return { ref: "", status: STATUSES[i] };
        if (low.length > s.length && low.slice(-s.length) === s && /\s/.test(low.charAt(low.length - s.length - 1))) {
          return { ref: a.slice(0, a.length - s.length).trim(), status: STATUSES[i] };
        }
      }
      return null;
    },

    /* "#2", "2", or part of a title */
    findItem: function (items, ref) {
      ref = (ref || "").trim();
      if (!ref) return { error: "Tell me which item: a #number from /ideas, or part of its title." };
      var m = /^#?(\d+)$/.exec(ref);
      if (m) {
        var it = items[Number(m[1]) - 1];
        return it ? { item: it } : { error: "There's no item #" + m[1] + "." };
      }
      var low = ref.toLowerCase();
      var hits = items.filter(function (i) { return i.title.toLowerCase().indexOf(low) > -1; });
      if (hits.length === 1) return { item: hits[0] };
      if (!hits.length) return { error: 'No item matches "' + ref + '".' };
      return { error: "More than one match: " + hits.map(function (h) { return h.title; }).join("; ") + ". Be more specific or use the #number." };
    },

    /* channel history -> alternating user/assistant messages for an AI call */
    buildContext: function (history) {
      var out = [];
      history.slice(-10).forEach(function (m) {
        var text = (m.text || m.code || "").trim().slice(0, 1500);
        if (!text) return;
        var role = m.author === "You" ? "user" : "assistant";
        if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += "\n" + text;
        else out.push({ role: role, content: text });
      });
      while (out.length && out[0].role !== "user") out.shift();
      return out;
    },

    agentSystem: function (agent, items) {
      var focus = {
        Idea: "Your job: help come up with and sharpen game ideas, and point out risks.",
        Builder: "Your job: plan and write Luau for Roblox features and review code. Say exactly where each script goes.",
        Library: "Your job: keep notes, changelogs and summaries tidy and short.",
        Analyst: "Your job: reason about player metrics and the economy, and say how sure you are.",
        Announcer: "Your job: write friendly, short Discord announcements.",
        Reviewer: "Your job: help keep the website files clean and safe.",
        Studio: "Your job: general studio helper and coordinator."
      }[agent] || "Your job: help the developer.";
      var board = items.slice(0, 15).map(function (i, n) { return "#" + (n + 1) + " [" + i.status + "] " + i.title; });
      return [
        "You are the " + agent + " agent in the studio chat of a solo Roblox developer (CORNY//STUDIO). " + focus,
        "Keep replies short (under 150 words) unless writing code. Plain text, no markdown headings.",
        "You can't publish, post or change anything yourself. When an action is needed, suggest the exact slash command, for example /createidea Title | notes, /buildprompt 2, /move 2 testing, /draft 2.",
        "Roblox advice must be server-authoritative and follow Roblox's rules. Never help with exploits, cheating or anything unsafe.",
        "Never ask for or repeat API keys, passwords or other secrets.",
        "Board right now:",
        board.length ? board.join("\n") : "(empty)"
      ].join("\n");
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
    toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
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
      var ct = (r.headers && r.headers.get("content-type")) || "";
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
      if (remote) return api("POST", "/board/log", { agent: agent, msg: msg });
      var b = localRead(); localLog(b, agent, msg); localWrite(b);
      return Promise.resolve();
    }
  };

  /* ================= AI providers (calls go through your Worker) ================= */
  var AI_ORDER = ["claude", "gpt", "gemini"];
  var AI_NAMES = { claude: "Claude", gpt: "GPT", gemini: "Gemini" };
  var AI_ALIASES = { claude: "claude", anthropic: "claude", gpt: "gpt", chatgpt: "gpt", openai: "gpt", gemini: "gemini", google: "gemini" };
  var PROVIDER_MAP = Object.assign({ general: "claude", ideas: "gpt", builder: "claude", library: "claude",
                                     analyst: "gemini", announcements: "gpt", reviewer: "claude" }, cfg.agentProviders || {});
  var aiState = { providers: { claude: {}, gpt: {}, gemini: {} }, used: 0, limit: 0, loaded: false };

  function aiReadyList() { return AI_ORDER.filter(function (n) { return aiState.providers[n] && aiState.providers[n].ready; }); }
  function pickProvider(ch) {
    var ready = aiReadyList();
    if (!ready.length) return null;
    return ready.indexOf(PROVIDER_MAP[ch]) > -1 ? PROVIDER_MAP[ch] : ready[0];
  }
  function aiAsk(provider, system, messages, maxTokens) {
    return api("POST", "/ai", { provider: provider, system: system, messages: messages, maxTokens: maxTokens }).then(function (r) {
      aiState.used = r.used; aiState.limit = r.limit; updateAiAgents();
      return r;
    });
  }
  function loadAi() {
    if (!remote) { updateAiAgents(); return Promise.resolve(); }
    return api("GET", "/ai/status").then(function (j) {
      aiState = { providers: j.providers, used: j.used, limit: j.limit, loaded: true }; updateAiAgents();
    }).catch(function () { updateAiAgents(); });
  }
  function updateAiAgents() {
    AI_ORDER.forEach(function (n) {
      var p = aiState.providers[n] || {};
      if (!remote) state[n] = { status: "offline", detail: "Needs relayUrl in config.js" };
      else if (p.ready) state[n] = { status: "active", detail: p.model + " · " + aiState.used + "/" + aiState.limit + " calls today" };
      else state[n] = { status: "offline", detail: p.hasKey ? "Add the model variable on the Worker" : "No API key on the Worker" };
    });
    var any = aiReadyList().length;
    state.aibuilder = any ? { status: "active", detail: "Writes code with /build using " + AI_NAMES[pickProvider("builder")] }
                          : { status: "offline", detail: "Needs an AI provider key on the Worker" };
    renderMembers();
  }

  /* ================= Agent status (member list) ================= */
  var AGENTS = [
    { id: "idea", name: "Idea", channel: "ideas", kind: "board" },
    { id: "builder", name: "Builder", channel: "builder", kind: "board" },
    { id: "library", name: "Library", channel: "library", kind: "board" },
    { id: "analyst", name: "Analyst", channel: "analyst", kind: "board" },
    { id: "announcer", name: "Announcer", channel: "announcements", kind: "board" },
    { id: "audit", name: "Repo Auditor", channel: "reviewer", kind: "worker", run: runAudit },
    { id: "links", name: "Link Checker", channel: "reviewer", kind: "worker", run: runLinks },
    { id: "layout", name: "Layout Guard", channel: "reviewer", kind: "worker", run: runLayout },
    { id: "telemetry", name: "Telemetry", channel: "analyst", kind: "live" },
    { id: "group", name: "Group Monitor", channel: "analyst", kind: "live" },
    { id: "market", name: "Market Manager", channel: "general", kind: "live" },
    { id: "claude", name: "Claude", channel: "general", kind: "ai" },
    { id: "gpt", name: "GPT", channel: "general", kind: "ai" },
    { id: "gemini", name: "Gemini", channel: "general", kind: "ai" },
    { id: "aibuilder", name: "AI Builder", channel: "builder", kind: "ai" },
    { id: "publisher", name: "Publisher (planned)", channel: "general", kind: "planned" }
  ];
  var state = {};
  AGENTS.forEach(function (a) {
    state[a.id] = a.kind === "planned" ? { status: "planned", detail: "Not built yet: needs an AI API account" }
                : a.kind === "worker" ? { status: "idle", detail: "Not run yet" }
                :                       { status: "idle", detail: "Checking..." };
  });
  state.publisher.detail = "Not built yet: needs a build pipeline. You publish in Studio for now";

  var live = { events: null, members: null, market: null, connOk: null };

  function setAgent(id, status, detail) { state[id] = { status: status, detail: detail }; renderMembers(); }

  function count(s) { return board.items.filter(function (i) { return i.status === s; }).length; }

  function updateBoardAgents() {
    var ideas = count("Idea"), building = count("Building");
    state.idea = { status: ideas ? "active" : "idle", detail: ideas + " idea" + (ideas === 1 ? "" : "s") + " waiting" };
    state.builder = { status: building ? "active" : "idle", detail: building + " item" + (building === 1 ? "" : "s") + " in Building" };
    state.library = { status: "active", detail: board.log.length + " log entries · " + count("Published") + " published" };
    if (state.analyst.detail === "Checking...") state.analyst = { status: "idle", detail: "Not run yet" };
    if (remote) state.announcer = board.announce ? { status: "active", detail: "Discord webhook ready" }
                                                 : { status: "offline", detail: "Add DISCORD_WEBHOOK secret to the Worker" };
    else state.announcer = { status: "offline", detail: "Needs relayUrl in config.js and a Discord webhook" };
  }

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
      renderMembers(); return;
    }
    getJson("/events?since=0").then(function (j) {
      var ev = j.events || [];
      live.events = ev.length;
      if (!ev.length) return setAgent("telemetry", "idle", "Relay connected, no Roblox events yet");
      var last = ev[ev.length - 1];
      setAgent("telemetry", Date.now() - last.t < 300000 ? "active" : "idle", ev.length + " recent events · last " + ago(last.t));
    }).catch(function (e) { setAgent("telemetry", "offline", "Relay unreachable (" + e.message + ")"); });

    if (!/^\d{1,12}$/.test(GROUP)) setAgent("group", "offline", "Set robloxGroupId in config.js");
    else getJson("/group?id=" + GROUP).then(function (j) {
      if (typeof j.memberCount === "number") live.members = j.memberCount;
      if (typeof j.memberCount === "number") setAgent("group", "active", j.memberCount.toLocaleString() + " members" + (j.name ? " · " + j.name : ""));
      else setAgent("group", "offline", "Roblox returned no data");
    }).catch(function (e) { setAgent("group", "offline", "Relay unreachable (" + e.message + ")"); });

    getJson("/market").then(function (j) {
      var n = (j.items || []).length;
      live.market = n;
      setAgent("market", "active", n + " published item" + (n === 1 ? "" : "s"));
    }).catch(function (e) { setAgent("market", "offline", "Relay unreachable (" + e.message + ")"); });
  }

  function boardSig() {
    return JSON.stringify([board.items.map(function (i) { return [i.id, i.status, i.title, i.notes]; }), board.log.length, board.announce]);
  }
  function loadBoard() {
    var before = boardSig();
    return Store.load().then(function () {
      live.connOk = true; updateBoardAgents(); renderMembers();
      if (boardSig() !== before) renderMessages();
    }, function (e) { live.connOk = false; renderMembers(); throw e; });
  }

  /* ================= Reviewer workers (real checks on your files) ================= */
  function read(f) {
    return fetch(f + "?_=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  async function runAudit() {
    var total = 0, flags = 0, missing = 0;
    for (var i = 0; i < FILES.length; i++) {
      try {
        var t = await read(FILES[i]); total += t.length;
        flags += (t.match(SECRET_RE) || []).filter(function (h) { return !/CHANGE_ME/.test(h); }).length;
      } catch (e) { missing++; }
      await sleep(80);
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
        checked++; await sleep(60);
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
      await sleep(60);
    }
    return scanned + " pages scanned · " + bad + " violation(s)";
  }

  /* ================= Chat engine ================= */
  // [text to insert or run, 1 = run straight away]
  var QUICK = {
    general: [["/status", 1], ["/board", 1], ["/help", 1], ["/ai", 1]],
    ideas: [["/createidea ", 0], ["/ideas", 1], ["/brainstorm", 1], ["/board", 1]],
    builder: [["/buildprompt ", 0], ["/move ", 0], ["/building ", 0], ["/testing ", 0], ["/ready ", 0]],
    library: [["/savetolibrary ", 0], ["/log", 1], ["/changelog", 1], ["/search ", 0]],
    analyst: [["/analyze", 1], ["/telemetry", 1], ["/members", 1]],
    announcements: [["/draft ", 0], ["/announce ", 0]],
    reviewer: [["/audit", 1], ["/links", 1], ["/layout", 1]]
  };
  var CHANNELS = [
    { id: "general", agent: "Studio", topic: "Everything at a glance. Try /status or /help",
      welcome: "Welcome to HQ. Your agents are in the channels on the left. Type / to see every command, or tap one below." },
    { id: "ideas", agent: "Idea", topic: "/createidea  /ideas  /brainstorm  /deleteidea",
      welcome: "Idea Agent here. Add ideas with /createidea <title> | <notes>, see them with /ideas, or get a brainstorm prompt with /brainstorm." },
    { id: "builder", agent: "Builder", topic: "/buildprompt  /move  /building  /testing  /ready  /published",
      welcome: "Builder Agent here. Give me an item with /buildprompt <#number or title> and I'll make a build prompt you can paste into your chat. Move items along with /building, /testing, /ready." },
    { id: "library", agent: "Library", topic: "/savetolibrary  /log  /changelog  /search",
      welcome: "Library Agent here. /savetolibrary <text> keeps a note (or saves the last reply here if you give no text). /log, /changelog and /search read it back." },
    { id: "analyst", agent: "Analyst", topic: "/analyze  /telemetry  /members",
      welcome: "Analyst Agent here. /analyze reads your live Roblox events and flags problems. These are signals from small samples, not facts." },
    { id: "announcements", agent: "Announcer", topic: "/draft  /announce (posts only when you press Accept)",
      welcome: "Announcer Agent here. /draft <item> or /announce <text> makes a Discord draft. Nothing posts until you press Accept." },
    { id: "reviewer", agent: "Reviewer", topic: "/audit  /links  /layout",
      welcome: "Reviewer Agent here. /audit, /links and /layout run real checks on your site files." }
  ];
  var COLORS = { You: "#cfe6f2", Studio: "#19f3ff", Idea: "#7ee6c8", Builder: "#f5a25d", Library: "#c5a5c5", Analyst: "#9be564", Announcer: "#ff8fcf", Reviewer: "#f5d44d",
                  Claude: "#e8a87c", GPT: "#74d3ae", Gemini: "#8ab4f8" };
  var GROUPS = [["Team", ["idea", "builder", "library", "analyst", "announcer"]], ["Reviewers", ["audit", "links", "layout"]],
                ["Live data", ["telemetry", "group", "market"]], ["AI", ["claude", "gpt", "gemini", "aibuilder"]], ["Planned", ["publisher"]]];

  var chat = { current: "general", msgs: {}, unread: {} };
  var pop = { open: false, sel: 0, list: [] };

  function channelAgent(id) { return CHANNELS.filter(function (c) { return c.id === id; })[0].agent; }

  function getMsgs(ch) {
    if (!chat.msgs[ch]) {
      try { chat.msgs[ch] = JSON.parse(sessionStorage.getItem(MSG_PREFIX + ch) || "[]"); } catch (e) { chat.msgs[ch] = []; }
    }
    return chat.msgs[ch];
  }
  function saveMsgs(ch) {
    chat.msgs[ch] = chat.msgs[ch].slice(-150);
    try { sessionStorage.setItem(MSG_PREFIX + ch, JSON.stringify(chat.msgs[ch])); } catch (e) {}
  }

  function say(ch, author, text, opts) {
    opts = opts || {};
    var m = { author: author, t: Date.now(), text: text || "" };
    if (opts.code) m.code = opts.code;
    if (opts.embed) m.embed = opts.embed;
    if (opts.buttons) m.buttons = opts.buttons;
    if (opts.via) m.via = opts.via;
    getMsgs(ch).push(m); saveMsgs(ch);
    if (ch === chat.current) renderMessages(author === "You");
    else { chat.unread[ch] = (chat.unread[ch] || 0) + 1; renderChannels(); }
  }

  function setTyping(text) { var t = $("typing"); t.textContent = text || ""; t.className = text ? "on" : ""; }

  /* ---------- rich text (safe: built from DOM nodes, never innerHTML) ---------- */
  function inline(parent, text) {
    var re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|https?:\/\/[^\s<>)]+)/g, last = 0, m;
    while ((m = re.exec(text))) {
      var tok = m[0];
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (tok.charAt(0) === "*") parent.appendChild(el("strong", "", tok.slice(2, -2)));
      else if (tok.charAt(0) === "`") parent.appendChild(el("code", "", tok.slice(1, -1)));
      else {
        var url = tok.replace(/[.,;:!?]+$/, "");
        re.lastIndex -= tok.length - url.length; tok = url;
        var a = el("a", "", url); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
        parent.appendChild(a);
      }
      last = m.index + tok.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function renderRich(box, text) {
    var lines = String(text).split("\n"), i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (/^```/.test(line)) {
        var buf = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; box.appendChild(el("pre", "code", buf.join("\n"))); continue;
      }
      var bullet = /^\s*[-•]\s+(.*)$/.exec(line);
      if (bullet) { var d = el("div", "li"), sp = el("span"); inline(sp, bullet[1]); d.appendChild(sp); box.appendChild(d); i++; continue; }
      var p = el("div", "p");
      if (line === "") p.appendChild(document.createTextNode("\u00a0")); else inline(p, line);
      box.appendChild(p); i++;
    }
  }
  window.AgentsUI = { renderRich: renderRich };

  /* ---------- sidebar, members, HUD ---------- */
  function chanStatus(id) {
    if (id === "reviewer") return ["audit", "links", "layout"].some(function (k) { return state[k].status === "working"; }) ? "working" : "idle";
    var map = { general: "market", ideas: "idea", builder: "builder", library: "library", analyst: "analyst", announcements: "announcer" };
    return state[map[id]] ? state[map[id]].status : "idle";
  }

  function renderChannels() {
    var box = $("channel-list"); if (!box) return;
    box.textContent = "";
    CHANNELS.forEach(function (c) {
      var n = chat.unread[c.id] || 0;
      var b = el("button", "ch" + (c.id === chat.current ? " active" : "") + (n ? " has-unread" : "")); b.type = "button";
      b.appendChild(el("span", "hash", "#")); b.appendChild(el("span", "nm", c.id));
      b.appendChild(el("span", "cdot " + chanStatus(c.id)));
      if (n) b.appendChild(el("span", "badge", String(n)));
      b.addEventListener("click", function () { openChannel(c.id); });
      box.appendChild(b);
    });
  }

  function renderMembers() {
    var box = $("member-list");
    if (box) {
      box.textContent = "";
      GROUPS.forEach(function (g) {
        box.appendChild(el("div", "label", g[0]));
        g[1].forEach(function (id) {
          var a = AGENTS.filter(function (x) { return x.id === id; })[0], s = state[id];
          var b = el("button", "member " + s.status); b.type = "button"; b.title = a.name + " — " + s.detail;
          b.appendChild(el("span", "dot"));
          b.appendChild(el("span", "mn", a.name.replace(" (planned)", "")));
          b.appendChild(el("span", "md", s.detail));
          b.addEventListener("click", function () { openChannel(a.channel); say(a.channel, "Studio", a.name + ": " + s.status + " · " + s.detail); });
          box.appendChild(b);
        });
      });
    }
    renderChannels(); renderHud();
  }

  function renderConn() {
    var c = $("conn"); if (!c) return;
    if (!remote) { c.textContent = "● This browser only"; c.className = "off"; }
    else if (live.connOk === false) { c.textContent = "● Worker offline"; c.className = "off"; }
    else if (live.connOk) { c.textContent = "● Worker connected"; c.className = "on"; }
    else { c.textContent = "● Connecting…"; c.className = ""; }
  }

  function renderHud() {
    renderConn();
    var box = $("hud"); if (!box) return;
    box.textContent = "";
    function chip(k, v, cls, cmd, tip) {
      var b = el("button", "chip " + (cls || "")); b.type = "button"; b.title = tip;
      b.appendChild(el("span", "k", k)); b.appendChild(el("span", "v", String(v)));
      b.addEventListener("click", function () { runText(cmd); });
      box.appendChild(b);
    }
    chip("Storage", !remote ? "Browser" : live.connOk === false ? "Offline" : "Worker", !remote ? "" : live.connOk === false ? "bad" : "good", "/status", "Where the board is saved. Click for full status");
    STATUSES.forEach(function (st) { chip(st, count(st), "s-" + st.toLowerCase(), "/ideas " + st, "Show " + st + " items"); });
    chip("Members", live.members === null ? "—" : live.members.toLocaleString(), "", "/members", "Roblox community members");
    chip("Events", live.events === null ? "—" : live.events, "", "/telemetry", "Recent Roblox events");
    var ready = aiReadyList().length;
    chip("AI", remote && ready ? aiState.used + "/" + aiState.limit : "off", ready ? "good" : "", "/ai", "AI providers and today's usage");
  }

  function renderChips() {
    var box = $("chips"); box.textContent = "";
    QUICK[chat.current].forEach(function (q) {
      var b = el("button", "qchip", q[0].trim()); b.type = "button"; b.title = q[1] ? "Run " + q[0].trim() : "Start typing " + q[0].trim();
      b.addEventListener("click", function () {
        if (q[1]) { runText(q[0]); return; }
        var i = $("msg-input"); i.value = q[0]; i.focus(); updatePop(); updateHint();
      });
      box.appendChild(b);
    });
  }

  /* ---------- messages ---------- */
  function dayLabel(t) {
    var d = new Date(t), n = new Date();
    var a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    var diff = Math.round((b - a) / 86400000);
    return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString();
  }

  function cardData(i, n) { return { id: i.id, n: n, title: i.title, status: i.status, notes: i.notes || "" }; }
  function mini(label, title, fn, cls) {
    var b = el("button", "mini" + (cls ? " " + cls : ""), label); b.type = "button"; b.title = title; b.setAttribute("aria-label", title);
    b.addEventListener("click", fn); return b;
  }
  function cardAct(promise) { return promise.then(loadBoard).catch(function (e) { toast(e.message, true); }); }

  // Cards read the live board, so their status and buttons stay current after a move
  function cardNode(c) {
    var it = board.items.filter(function (i) { return i.id === c.id; })[0];
    var node = el("div", "icard" + (it ? "" : " gone"));
    var top = el("div", "top");
    top.appendChild(el("span", "n", it ? "#" + (board.items.indexOf(it) + 1) : "—"));
    top.appendChild(el("span", "ti", it ? it.title : c.title));
    top.appendChild(el("span", "pill " + (it ? it.status : "gone"), it ? it.status : "removed"));
    node.appendChild(top);
    var notes = it ? it.notes : c.notes;
    if (notes) node.appendChild(el("div", "no", notes));
    if (it) {
      var acts = el("div", "acts"), col = STATUSES.indexOf(it.status);
      if (col > 0) acts.appendChild(mini("◀", "Move to " + STATUSES[col - 1], function () { cardAct(Store.setStatus(it.id, STATUSES[col - 1])); }));
      if (col < STATUSES.length - 1) acts.appendChild(mini("▶", "Move to " + STATUSES[col + 1], function () { cardAct(Store.setStatus(it.id, STATUSES[col + 1])); }));
      if (it.status === "Idea" || it.status === "Building") acts.appendChild(mini("Prompt", "Copy a build prompt for this item", function () { copyText(Lib.buildBuildPrompt(it), "Build prompt copied. Paste it into your chat."); }));
      acts.appendChild(mini("✕", "Delete this item", function () { if (confirm('Delete "' + it.title + '"?')) cardAct(Store.remove(it.id)); }, "danger"));
      node.appendChild(acts);
    }
    return node;
  }

  function embedNode(e, color) {
    var box = el("div", "embed"); box.style.borderLeftColor = color;
    if (e.title) box.appendChild(el("strong", "et", e.title));
    if (e.cards && e.cards.length) {
      var wrap = el("div", "cards");
      e.cards.forEach(function (c) { wrap.appendChild(cardNode(c)); });
      box.appendChild(wrap);
    } else {
      (e.lines || []).forEach(function (l) { box.appendChild(l === "" ? el("div", "ln gap") : el("div", "ln", l)); });
    }
    return box;
  }

  function msgNode(m, idx, ch, prev) {
    var compact = prev && prev.author === m.author && (m.t - prev.t) < 300000 && dayLabel(prev.t) === dayLabel(m.t);
    var color = COLORS[m.author] || "#cfe6f2";
    var row = el("div", "msg" + (compact ? " compact" : "") + (m.author === "You" ? " me" : ""));
    var av = el("div", "avatar", m.author.charAt(0).toUpperCase());
    av.style.background = "linear-gradient(135deg, " + color + ", #0b1118 170%)";
    row.appendChild(av);
    var body = el("div", "body");
    var meta = el("div", "meta");
    var nm = el("span", "name", m.author); nm.style.color = color; meta.appendChild(nm);
    if (m.author !== "You") meta.appendChild(el("span", "tag", m.via ? "AI · " + m.via : "AGENT"));
    var tm = el("span", "time", new Date(m.t).toTimeString().slice(0, 5)); tm.title = new Date(m.t).toLocaleString(); meta.appendChild(tm);
    body.appendChild(meta);
    if (m.text) {
      var t = el("div", "text" + (m.author === "You" ? " plain" : ""));
      if (m.author === "You") t.textContent = m.text; else renderRich(t, m.text);
      body.appendChild(t);
    }
    if (m.code) body.appendChild(el("pre", "code", m.code));
    if (m.embed) body.appendChild(embedNode(m.embed, color));
    if (m.buttons && m.buttons.length) {
      var bs = el("div", "btns");
      m.buttons.forEach(function (bt, bi) {
        var b = el("button", bt.primary ? "primary" : "", bt.done ? "✓ " + bt.label : bt.label);
        b.type = "button"; b.disabled = !!bt.done;
        b.addEventListener("click", function () { onButton(ch, idx, bi); });
        bs.appendChild(b);
      });
      body.appendChild(bs);
    }
    row.appendChild(body);
    if (m.code || m.text) {
      var cb = el("button", "mcopy", "Copy"); cb.type = "button"; cb.setAttribute("aria-label", "Copy this message");
      cb.addEventListener("click", function () { copyText(m.code || m.text, "Copied."); });
      row.appendChild(cb);
    }
    return row;
  }

  function nearBottom(box) { return !(box.scrollHeight - box.scrollTop - box.clientHeight > 80); }
  function updateJump() { var box = $("messages"); $("jump").hidden = !(box.scrollHeight - box.scrollTop - box.clientHeight > 140); }

  function renderMessages(forceBottom) {
    var box = $("messages");
    var stick = nearBottom(box), prevTop = box.scrollTop;
    box.textContent = "";
    var list = getMsgs(chat.current), lastDay = "";
    list.forEach(function (m, i) {
      var d = dayLabel(m.t);
      if (d !== lastDay) { box.appendChild(el("div", "day", d)); lastDay = d; }
      box.appendChild(msgNode(m, i, chat.current, list[i - 1]));
    });
    box.scrollTop = (forceBottom || stick) ? box.scrollHeight : prevTop;
    updateJump();
  }

  function openChannel(id) {
    chat.current = id; chat.unread[id] = 0;
    var c = CHANNELS.filter(function (x) { return x.id === id; })[0];
    $("chan-title").textContent = "# " + id;
    $("chan-topic").textContent = c.topic;
    var list = getMsgs(id);
    if (!list.length) {
      list.push({ author: c.agent, t: Date.now(), text: c.welcome,
        buttons: QUICK[id].filter(function (q) { return q[1]; }).map(function (q) { return { label: q[0], action: "run", payload: q[0] }; }) });
      saveMsgs(id);
    }
    renderChannels(); renderChips(); renderMessages(true);
    $("members").classList.remove("open");
    $("msg-input").focus();
  }

  /* ---------- buttons inside messages ---------- */
  function markDone(ch, idx, bi) { var m = getMsgs(ch)[idx]; if (m && m.buttons[bi]) { m.buttons[bi].done = true; saveMsgs(ch); renderMessages(); } }

  async function onButton(ch, idx, bi) {
    var m = getMsgs(ch)[idx]; if (!m) return;
    var b = m.buttons[bi]; if (!b || b.done) return;
    try {
      if (b.action === "copy") { copyText(b.payload, "Copied."); return; }
      if (b.action === "run") { runText(b.payload); return; }
      if (b.action === "addidea") {
        await Store.add(b.payload.slice(0, 100), b.payload); await loadBoard();
        markDone(ch, idx, bi); say(ch, "Idea", "Added to the board: " + b.payload.slice(0, 100)); return;
      }
      if (b.action === "post") {
        if (!remote || !board.announce) { say(ch, "Announcer", "I can't post yet: " + (remote ? "add a DISCORD_WEBHOOK secret to your Worker." : "set relayUrl in config.js and add a DISCORD_WEBHOOK secret.") + " You can still copy the text."); return; }
        if (!confirm("Post this to Discord now?")) return;
        await api("POST", "/announce", { text: b.payload });
        markDone(ch, idx, bi);
        var it = board.items.filter(function (i) { return i.id === b.itemId; })[0];
        if (it && it.status === "Ready") { await Store.setStatus(it.id, "Published"); await loadBoard(); say(ch, "Announcer", "Posted to Discord. Moved \"" + it.title + "\" to Published."); }
        else say(ch, "Announcer", "Posted to Discord.");
      }
    } catch (e) { say(ch, "Studio", "⚠ " + e.message); }
  }

  /* ---------- commands ---------- */
  function numbered() { return board.items.map(function (i, n) { return "#" + (n + 1) + " [" + i.status + "] " + i.title; }); }

  function resolve(ch, ref, agent) {
    var r = Lib.findItem(board.items, ref);
    if (r.error) { say(ch, agent, r.error); return null; }
    return r.item;
  }

  function copyBtn(payload, label) { return { label: label || "Copy", action: "copy", payload: payload }; }

  async function cmdHelp(args, ch) {
    if (args) {
      var c = COMMANDS.filter(function (x) { return x.name === args.replace(/^\//, "").toLowerCase(); })[0];
      if (!c) { say(ch, "Studio", "No command called " + args + ". Type /help for the list."); return; }
      say(ch, c.agent, c.usage + "\n" + c.desc); return;
    }
    var lines = [];
    ["Studio", "Idea", "Builder", "Library", "Analyst", "Announcer", "Reviewer"].forEach(function (agent) {
      COMMANDS.filter(function (c) { return c.agent === agent; }).forEach(function (c) { lines.push(c.usage + "  —  " + c.desc); });
    });
    say(ch, "Studio", "Commands work in any channel. Use #number or part of a title to point at an item.", { embed: { title: "All commands", lines: lines } });
  }

  async function cmdStatus(args, ch) {
    await loadBoard();
    var lines = STATUSES.map(function (s) { return s + ": " + count(s); });
    lines.push("");
    AGENTS.forEach(function (a) { lines.push(a.name + " — " + state[a.id].status + " · " + state[a.id].detail); });
    say(ch, "Studio", "", { embed: { title: "Studio status", lines: lines } });
  }

  async function cmdBoard(args, ch) {
    await loadBoard();
    if (!board.items.length) { say(ch, "Idea", "The board is empty. Try /createidea <title> | <notes>."); return; }
    var lines = [];
    STATUSES.forEach(function (s) {
      var here = [];
      board.items.forEach(function (i, n) { if (i.status === s) here.push("#" + (n + 1) + " " + i.title); });
      lines.push(s + " (" + here.length + "): " + (here.length ? here.join(", ") : "-"));
    });
    say(ch, "Idea", "", { embed: { title: "Board", lines: lines } });
  }

  async function cmdIdeas(args, ch) {
    await loadBoard();
    var want = STATUSES.filter(function (s) { return s.toLowerCase() === args.toLowerCase(); })[0];
    var lines = board.items.map(function (i, n) { return { s: i.status, t: "#" + (n + 1) + " [" + i.status + "] " + i.title }; })
      .filter(function (x) { return !want || x.s === want; }).map(function (x) { return x.t; });
    if (!lines.length) { say(ch, "Idea", want ? "Nothing in " + want + "." : "No ideas yet. Try /createidea <title> | <notes>."); return; }
    var shown = board.items.map(function (i, n) { return { i: i, n: n + 1 }; }).filter(function (x) { return !want || x.i.status === want; }).slice(0, 25);
    say(ch, "Idea", "", { embed: { title: want ? want + " items" : "Ideas on the board", lines: lines.slice(0, 25),
      cards: shown.map(function (x) { return cardData(x.i, x.n); }) } });
  }

  async function cmdCreateIdea(args, ch) {
    var p = Lib.splitIdea(args);
    if (!p.title) { say(ch, "Idea", "Give it a title: /createidea Daily rewards | login streak bonus"); return; }
    await Store.add(p.title, p.notes); await loadBoard();
    var made = board.items[0];
    say(ch, "Idea", "Added \"" + p.title + "\" as #1 in Idea. Try /buildprompt 1 when you're ready to build it.",
      made && made.title === p.title ? { embed: { title: "New idea", lines: ["#1 [Idea] " + made.title], cards: [cardData(made, 1)] } } : undefined);
  }

  async function cmdMove(args, ch) {
    await loadBoard();
    var p = Lib.parseMove(args);
    if (!p) { say(ch, "Builder", "Use: /move <#number or title> <" + STATUSES.join("|") + ">"); return; }
    var it = resolve(ch, p.ref, "Builder"); if (!it) return;
    await Store.setStatus(it.id, p.status); await loadBoard();
    var moved = board.items.filter(function (i) { return i.id === it.id; })[0];
    say(ch, "Builder", "Moved \"" + it.title + "\" to " + p.status + ".",
      moved ? { embed: { title: "", lines: ["#" + (board.items.indexOf(moved) + 1) + " [" + moved.status + "] " + moved.title], cards: [cardData(moved, board.items.indexOf(moved) + 1)] } } : undefined);
  }

  function statusShortcut(status) {
    return async function (args, ch) { await cmdMove(args + " " + status, ch); };
  }

  async function cmdDelete(args, ch) {
    await loadBoard();
    var it = resolve(ch, args, "Idea"); if (!it) return;
    if (!confirm("Delete \"" + it.title + "\"?")) { say(ch, "Idea", "Cancelled."); return; }
    await Store.remove(it.id); await loadBoard();
    say(ch, "Idea", "Deleted \"" + it.title + "\".");
  }

  async function cmdBrainstorm(args, ch) {
    await loadBoard();
    var p = Lib.buildIdeaPrompt(board.items);
    say(ch, "Idea", "Brainstorm prompt ready. Copy it into your chat with the AI:", { code: p, buttons: [copyBtn(p, "Copy prompt")] });
  }

  async function cmdBuildPrompt(args, ch) {
    await loadBoard();
    var it = resolve(ch, args, "Builder"); if (!it) return;
    var p = Lib.buildBuildPrompt(it);
    say(ch, "Builder", "Build prompt for \"" + it.title + "\":", { code: p, buttons: [copyBtn(p, "Copy prompt")] });
  }

  async function cmdSave(args, ch) {
    var text = args;
    if (!text) {
      var list = getMsgs(ch).slice().reverse();
      var last = list.filter(function (m) { return m.author !== "You" && (m.code || m.text || m.embed); })[0];
      if (last) text = last.code || last.text || (last.embed.lines || []).join(" | ");
    }
    if (!text) { say(ch, "Library", "Nothing to save. Try /savetolibrary <text>."); return; }
    await Store.log("Library", "Saved: " + text.replace(/\s+/g, " ").slice(0, 250)); await loadBoard();
    say(ch, "Library", "Saved to the library log.");
  }

  async function cmdLog(args, ch) {
    await loadBoard();
    var n = Math.max(1, Math.min(30, parseInt(args, 10) || 10));
    var rows = board.log.slice(-n).reverse().map(function (e) { return new Date(e.t).toLocaleString() + "  " + e.agent + ": " + e.msg; });
    if (!rows.length) { say(ch, "Library", "The log is empty."); return; }
    say(ch, "Library", "", { embed: { title: "Last " + rows.length + " log entries", lines: rows } });
  }

  async function cmdChangelog(args, ch) {
    await loadBoard();
    var t = Lib.buildChangelog(board.items);
    say(ch, "Library", "Changelog from your Published items:", { code: t, buttons: [copyBtn(t, "Copy changelog")] });
  }

  async function cmdSearch(args, ch) {
    if (!args) { say(ch, "Library", "Search for what? /search <text>"); return; }
    await loadBoard();
    var q = args.toLowerCase(), lines = [];
    board.items.forEach(function (i, n) { if ((i.title + " " + (i.notes || "")).toLowerCase().indexOf(q) > -1) lines.push("Board #" + (n + 1) + " [" + i.status + "] " + i.title); });
    board.log.slice().reverse().forEach(function (e) { if (e.msg.toLowerCase().indexOf(q) > -1 && lines.length < 25) lines.push("Log " + e.agent + ": " + e.msg); });
    if (!lines.length) { say(ch, "Library", "Nothing found for \"" + args + "\"."); return; }
    say(ch, "Library", "", { embed: { title: "Results for \"" + args + "\"", lines: lines.slice(0, 25) } });
  }

  async function cmdAnalyze(args, ch) {
    if (!RELAY) { say(ch, "Analyst", "I read your relay, which isn't set. Add relayUrl to config.js first."); return; }
    setAgent("analyst", "working", "Reading events...");
    try {
      var j = await getJson("/events?since=0");
      var r = Lib.analyze(j.events || []);
      var lines = ["Events read: " + r.events, "Joins " + r.counts.join + " · Leaves " + r.counts.leave + " · Purchases " + r.counts.purchase,
                   "Robux seen: " + r.robux, "Coins minted " + r.minted + " · sunk " + r.sunk,
                   "Avg minutes played: " + (r.avgMins === null ? "n/a" : r.avgMins.toFixed(1)), ""].concat(r.findings.map(function (f) { return "• " + f; }));
      var real = r.events >= 30 ? r.findings.filter(function (f) { return !/^No clear problems/.test(f); }) : [];
      say(ch, "Analyst", "", { embed: { title: "Analysis", lines: lines },
        buttons: real.slice(0, 4).map(function (f, i) { return { label: "Add finding " + (i + 1) + " to ideas", action: "addidea", payload: "Investigate: " + f }; }) });
      setAgent("analyst", "idle", "Last run " + now() + " · " + r.events + " events");
      await Store.log("Analyst", "Read " + r.events + " events: " + r.findings[0].slice(0, 120));
    } catch (e) { setAgent("analyst", "offline", "Relay unreachable (" + e.message + ")"); say(ch, "Analyst", "⚠ " + e.message); }
  }

  async function cmdTelemetry(args, ch) {
    if (!RELAY) { say(ch, "Analyst", "Set relayUrl in config.js first."); return; }
    var j = await getJson("/events?since=0"), ev = j.events || [];
    if (!ev.length) { say(ch, "Analyst", "Relay is up but no Roblox events have arrived yet."); return; }
    var counts = {}; ev.forEach(function (e) { counts[e.type] = (counts[e.type] || 0) + 1; });
    var last = ev[ev.length - 1];
    say(ch, "Analyst", "", { embed: { title: "Telemetry", lines: [ev.length + " recent events · last " + ago(last.t),
      Object.keys(counts).map(function (k) { return k + " " + counts[k]; }).join(" · ")] } });
  }

  async function cmdMembers(args, ch) {
    if (!RELAY || !/^\d{1,12}$/.test(GROUP)) { say(ch, "Analyst", "Needs relayUrl and robloxGroupId in config.js."); return; }
    var j = await getJson("/group?id=" + GROUP);
    say(ch, "Analyst", typeof j.memberCount === "number" ? (j.name ? j.name + ": " : "") + j.memberCount.toLocaleString() + " members." : "Roblox returned no data.");
  }

  function draftMessage(ch, text, itemId, label) {
    say(ch, "Announcer", label, { code: text, buttons: [{ label: "Accept and post to Discord", action: "post", payload: text, itemId: itemId || "", primary: true }, copyBtn(text, "Copy text")] });
  }

  async function cmdDraft(args, ch) {
    await loadBoard();
    var it = resolve(ch, args, "Announcer"); if (!it) return;
    draftMessage(ch, Lib.buildAnnouncement(it, GROUP), it.id, "Draft for \"" + it.title + "\". Nothing posts until you press Accept:");
  }

  async function cmdAnnounce(args, ch) {
    if (!args) { say(ch, "Announcer", "Use /announce <text> for a custom post, or /draft <item>."); return; }
    await loadBoard();
    draftMessage(ch, args.slice(0, 1800), "", "Custom draft. Nothing posts until you press Accept:");
  }

  async function runReview(agentId, label, ch) {
    var a = AGENTS.filter(function (x) { return x.id === agentId; })[0];
    setAgent(agentId, "working", "Running...");
    try {
      var result = await a.run();
      setAgent(agentId, "idle", "Last run " + now() + " · " + result);
      say(ch, "Reviewer", label + ": " + result);
      await Store.log("Reviewer", label + ": " + result);
    } catch (e) { setAgent(agentId, "idle", "Last run failed: " + e.message); say(ch, "Reviewer", "⚠ " + label + " failed: " + e.message); }
  }

  function needAi(ch, agent) {
    if (!remote) { say(ch, agent, "AI needs your relay. Set relayUrl in config.js and add provider keys to the Worker. Type /ai for details."); return false; }
    if (!aiReadyList().length) { say(ch, agent, "No AI provider is connected yet. Add a key (and model) to your Worker, then type /ai to check."); return false; }
    return true;
  }

  async function cmdAi(args, ch) {
    await loadAi();
    if (!remote) { say(ch, "Studio", "AI needs your relay. Set relayUrl in config.js first."); return; }
    var lines = AI_ORDER.map(function (n) {
      var p = aiState.providers[n] || {};
      return AI_NAMES[n] + " — " + (p.ready ? "ready · " + p.model : p.hasKey ? "key set, add the model variable" : "no key on the Worker");
    });
    lines.push("", "Calls today: " + aiState.used + " / " + aiState.limit + " (resets midnight UTC)");
    if (!aiReadyList().length) lines.push("", "Add ANTHROPIC_API_KEY, OPENAI_API_KEY + OPENAI_MODEL, or GEMINI_API_KEY + GEMINI_MODEL as Worker settings.");
    say(ch, "Studio", "", { embed: { title: "AI providers", lines: lines } });
  }

  async function cmdAsk(args, ch) {
    var m = /^(\S+)\s+([\s\S]+)$/.exec(args);
    var provider = m && AI_ALIASES[m[1].toLowerCase()];
    if (!provider) { say(ch, "Studio", "Use: /ask <claude|gpt|gemini> <question>"); return; }
    await loadAi();
    if (!needAi(ch, "Studio")) return;
    if (!aiState.providers[provider].ready) { say(ch, "Studio", AI_NAMES[provider] + " isn't connected. Ready: " + aiReadyList().map(function (n) { return AI_NAMES[n]; }).join(", ") + "."); return; }
    await loadBoard().catch(function () {});
    var agent = channelAgent(ch);
    var r = await aiAsk(provider, Lib.agentSystem(agent, board.items), [{ role: "user", content: m[2].slice(0, 3000) }]);
    say(ch, agent, r.text, { via: AI_NAMES[provider] });
  }

  async function cmdCouncil(args, ch) {
    if (!args) { say(ch, "Studio", "Use: /council <question>. Every connected AI answers, then one summarises where they agree and differ."); return; }
    await loadAi();
    if (!needAi(ch, "Studio")) return;
    var ready = aiReadyList();
    var needed = ready.length + (ready.length > 1 ? 1 : 0);
    if (aiState.limit - aiState.used < needed) { say(ch, "Studio", "Not enough AI calls left today for a council (" + (aiState.limit - aiState.used) + " left, needs " + needed + ")."); return; }
    await loadBoard().catch(function () {});
    var system = Lib.agentSystem("Studio", board.items), q = args.slice(0, 3000);
    var results = await Promise.all(ready.map(function (n) {
      return aiAsk(n, system, [{ role: "user", content: q }]).then(function (r) { return { n: n, text: r.text }; }, function (e) { return { n: n, error: e.message }; });
    }));
    var answers = results.filter(function (r) { return r.text; });
    results.forEach(function (r) {
      if (r.text) say(ch, AI_NAMES[r.n], r.text);
      else say(ch, "Studio", "⚠ " + AI_NAMES[r.n] + " failed: " + r.error);
    });
    if (ready.length === 1) { say(ch, "Studio", "Only " + AI_NAMES[ready[0]] + " is connected, so there's nothing to compare. Connect another provider for a real council."); return; }
    if (answers.length < 2) return;
    var judge = ready.indexOf("claude") > -1 ? "claude" : ready[0];
    var merge = "Several AI models answered the same question. In under 120 words say where they agree, where they differ, and what you recommend.\n\nQuestion: " + q + "\n\n" +
      answers.map(function (a) { return "[" + AI_NAMES[a.n] + "]: " + a.text.slice(0, 1500); }).join("\n\n");
    var r = await aiAsk(judge, Lib.agentSystem("Studio", board.items), [{ role: "user", content: merge }]);
    say(ch, "Studio", r.text, { via: AI_NAMES[judge] + " (summary)" });
  }

  async function cmdBuild(args, ch) {
    await loadAi();
    await loadBoard();
    var it = resolve(ch, args, "Builder"); if (!it) return;
    if (!needAi(ch, "Builder")) { say(ch, "Builder", "Meanwhile /buildprompt " + (board.items.indexOf(it) + 1) + " gives you a prompt to paste into your own chat."); return; }
    var provider = pickProvider("builder");
    var system = Lib.agentSystem("Builder", board.items) + "\nWrite complete, working Luau. Start with a one-line plan, then each script with its location. Keep it as short as it can be while still working.";
    var r = await aiAsk(provider, system, [{ role: "user", content: Lib.buildBuildPrompt(it) }], 1800);
    say(ch, "Builder", "Draft for \"" + it.title + "\" (" + AI_NAMES[provider] + "). Review it before using; nothing in your game was changed:", { code: r.text, via: AI_NAMES[provider], buttons: [copyBtn(r.text, "Copy code")] });
  }

  async function cmdClear(args, ch) { chat.msgs[ch] = []; saveMsgs(ch); renderMessages(); }

  var COMMANDS = [
    { name: "help", usage: "/help [command]", desc: "List commands or explain one", agent: "Studio", run: cmdHelp },
    { name: "status", usage: "/status", desc: "Board counts and every agent's status", agent: "Studio", run: cmdStatus },
    { name: "clear", usage: "/clear", desc: "Clear this channel's chat", agent: "Studio", run: cmdClear },
    { name: "ai", usage: "/ai", desc: "Which AI providers are connected, and today's usage", agent: "Studio", run: cmdAi },
    { name: "ask", usage: "/ask <claude|gpt|gemini> <question>", desc: "Ask one specific AI", agent: "Studio", run: cmdAsk },
    { name: "council", usage: "/council <question>", desc: "Every connected AI answers, then a summary of agreement and differences", agent: "Studio", run: cmdCouncil },
    { name: "createidea", usage: "/createidea <title> | <notes>", desc: "Add an idea to the board", agent: "Idea", run: cmdCreateIdea },
    { name: "ideas", usage: "/ideas [status]", desc: "List items, optionally one status", agent: "Idea", run: cmdIdeas },
    { name: "board", usage: "/board", desc: "Show every column of the board", agent: "Idea", run: cmdBoard },
    { name: "brainstorm", usage: "/brainstorm", desc: "Make a brainstorm prompt to paste into your chat", agent: "Idea", run: cmdBrainstorm },
    { name: "deleteidea", usage: "/deleteidea <item>", desc: "Delete an item (asks first)", agent: "Idea", run: cmdDelete },
    { name: "buildprompt", usage: "/buildprompt <item>", desc: "Make a build prompt for an item", agent: "Builder", run: cmdBuildPrompt },
    { name: "build", usage: "/build <item>", desc: "AI writes a Luau draft for an item (you review and paste it)", agent: "Builder", run: cmdBuild },
    { name: "move", usage: "/move <item> <status>", desc: "Move an item to Idea, Building, Testing, Ready or Published", agent: "Builder", run: cmdMove },
    { name: "building", usage: "/building <item>", desc: "Shortcut: move to Building", agent: "Builder", run: statusShortcut("Building") },
    { name: "testing", usage: "/testing <item>", desc: "Shortcut: move to Testing", agent: "Builder", run: statusShortcut("Testing") },
    { name: "ready", usage: "/ready <item>", desc: "Shortcut: move to Ready", agent: "Builder", run: statusShortcut("Ready") },
    { name: "published", usage: "/published <item>", desc: "Mark as Published (you still publish in Studio)", agent: "Builder", run: statusShortcut("Published") },
    { name: "savetolibrary", usage: "/savetolibrary [text]", desc: "Save a note, or the last agent reply if you give no text", agent: "Library", run: cmdSave },
    { name: "log", usage: "/log [count]", desc: "Show the latest log entries", agent: "Library", run: cmdLog },
    { name: "changelog", usage: "/changelog", desc: "Changelog built from Published items", agent: "Library", run: cmdChangelog },
    { name: "search", usage: "/search <text>", desc: "Search the board and the log", agent: "Library", run: cmdSearch },
    { name: "analyze", usage: "/analyze", desc: "Analyze your live Roblox events", agent: "Analyst", run: cmdAnalyze },
    { name: "telemetry", usage: "/telemetry", desc: "Summary of recent Roblox events", agent: "Analyst", run: cmdTelemetry },
    { name: "members", usage: "/members", desc: "Roblox community member count", agent: "Analyst", run: cmdMembers },
    { name: "draft", usage: "/draft <item>", desc: "Draft a Discord update for an item", agent: "Announcer", run: cmdDraft },
    { name: "announce", usage: "/announce <text>", desc: "Draft a custom Discord post (posts only on Accept)", agent: "Announcer", run: cmdAnnounce },
    { name: "audit", usage: "/audit", desc: "Scan site files for size and secret-looking strings", agent: "Reviewer", run: function (a, ch) { return runReview("audit", "Repo Auditor", ch); } },
    { name: "links", usage: "/links", desc: "Check that internal pages load", agent: "Reviewer", run: function (a, ch) { return runReview("links", "Link Checker", ch); } },
    { name: "layout", usage: "/layout", desc: "Check root-only files and no external CSS", agent: "Reviewer", run: function (a, ch) { return runReview("layout", "Layout Guard", ch); } }
  ];

  /* ---------- free text: the channel's AI if one is connected, otherwise keyword help ---------- */
  async function freeText(text, ch) {
    var low = text.toLowerCase();
    if (/^(help|commands)\??$/.test(low)) return cmdHelp("", ch);
    if (remote && !aiState.loaded) await loadAi();
    var provider = remote ? pickProvider(ch) : null;
    if (provider) {
      var agent = channelAgent(ch);
      await loadBoard().catch(function () {});
      setTyping(agent + " is thinking (" + AI_NAMES[provider] + ")...");
      var r = await aiAsk(provider, Lib.agentSystem(agent, board.items), Lib.buildContext(getMsgs(ch)));
      say(ch, agent, r.text, { via: AI_NAMES[provider] });
      return;
    }
    if (/\b(help|commands|what can you do)\b/.test(low)) return cmdHelp("", ch);
    if (/\b(status|how are things)\b/.test(low)) return cmdStatus("", ch);
    if (/\b(board|ideas)\b/.test(low)) return cmdBoard("", ch);
    say(ch, channelAgent(ch), "I only follow slash commands right now. Type / to see what I can do. To chat naturally, connect an AI provider on your Worker (type /ai).");
  }

  /* ---------- input handling ---------- */
  var hist = { list: null, i: -1 };
  function histList() {
    if (!hist.list) { try { hist.list = JSON.parse(sessionStorage.getItem("corny_chat_hist") || "[]"); } catch (e) { hist.list = []; } }
    return hist.list;
  }
  function histPush(raw) {
    var l = histList();
    if (l[l.length - 1] !== raw) l.push(raw);
    hist.list = l.slice(-50); hist.i = -1;
    try { sessionStorage.setItem("corny_chat_hist", JSON.stringify(hist.list)); } catch (e) {}
  }
  function histMove(dir) {
    var l = histList(), input = $("msg-input");
    if (!l.length) return false;
    if (dir < 0) hist.i = hist.i === -1 ? l.length - 1 : Math.max(0, hist.i - 1);
    else {
      if (hist.i === -1) return false;
      hist.i++;
      if (hist.i >= l.length) { hist.i = -1; input.value = ""; return true; }
    }
    input.value = l[hist.i]; return true;
  }

  function autosize() {
    var i = $("msg-input");
    i.style.height = "auto";
    if (i.scrollHeight) i.style.height = Math.min(i.scrollHeight, 140) + "px";
  }

  async function submit() {
    var input = $("msg-input"), raw = input.value.trim();
    if (!raw) return;
    input.value = ""; autosize(); hidePop(); updateHint(); histPush(raw);
    var ch = chat.current;
    say(ch, "You", raw);
    var parsed = Lib.parseCommand(raw);
    try {
      if (parsed) {
        var cmd = COMMANDS.filter(function (c) { return c.name === parsed.name; })[0];
        if (!cmd) { say(ch, "Studio", "I don't know /" + parsed.name + ". Type /help to see the commands."); return; }
        setTyping(cmd.agent + " is working...");
        await cmd.run(parsed.args, ch);
      } else {
        await freeText(raw, ch);
      }
    } catch (e) { say(ch, "Studio", "⚠ " + e.message); }
    setTyping("");
  }

  function runText(raw) { $("msg-input").value = raw; return submit(); }

  function hidePop() { pop.open = false; $("slash-pop").hidden = true; }

  function renderPop() {
    var box = $("slash-pop"); box.textContent = "";
    pop.list.forEach(function (c, i) {
      var o = el("div", "opt" + (i === pop.sel ? " sel" : ""));
      var dot = el("span", "od"); dot.style.background = COLORS[c.agent] || "#19f3ff"; o.appendChild(dot);
      var u = el("span", "u"); u.appendChild(el("b", "", "/" + c.name)); u.appendChild(document.createTextNode(c.usage.slice(c.name.length + 1)));
      o.appendChild(u); o.appendChild(el("span", "d", c.desc));
      o.addEventListener("mousedown", function (e) { e.preventDefault(); pop.sel = i; completePop(); });
      box.appendChild(o);
    });
    box.hidden = false;
  }

  function updatePop() {
    var v = $("msg-input").value;
    if (v.charAt(0) !== "/" || /\s/.test(v)) { hidePop(); return; }
    var q = v.slice(1).toLowerCase();
    pop.list = COMMANDS.filter(function (c) { return c.name.indexOf(q) === 0; }).slice(0, 8);
    if (!pop.list.length) { hidePop(); return; }
    pop.open = true; pop.sel = 0; renderPop();
  }

  // Shows the command's usage while you type its arguments
  function updateHint() {
    var h = $("hint"), v = $("msg-input").value;
    var m = /^\/(\S+)\s/.exec(v);
    var c = m && COMMANDS.filter(function (x) { return x.name === m[1].toLowerCase(); })[0];
    h.textContent = "";
    if (!c) return;
    h.appendChild(el("b", "", c.usage)); h.appendChild(document.createTextNode("  —  " + c.desc));
  }

  function completePop() {
    var c = pop.list[pop.sel]; if (!c) return;
    var input = $("msg-input"); input.value = "/" + c.name + " ";
    hidePop(); updateHint(); input.focus();
  }

  function switchChannel(dir) {
    var ids = CHANNELS.map(function (c) { return c.id; });
    var i = (ids.indexOf(chat.current) + dir + ids.length) % ids.length;
    openChannel(ids[i]);
  }

  function onKey(e) {
    var input = $("msg-input");
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); switchChannel(e.key === "ArrowDown" ? 1 : -1); return; }
    if (pop.open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      pop.sel = (pop.sel + (e.key === "ArrowDown" ? 1 : -1) + pop.list.length) % pop.list.length; renderPop(); return;
    }
    if (pop.open && e.key === "Tab") { e.preventDefault(); completePop(); return; }
    if (e.key === "ArrowUp" && (input.value === "" || hist.i !== -1)) { if (histMove(-1)) { e.preventDefault(); updateHint(); } return; }
    if (e.key === "ArrowDown" && hist.i !== -1) { if (histMove(1)) { e.preventDefault(); updateHint(); } return; }
    if (e.key === "Escape") { hidePop(); return; }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      var typed = input.value.trim().slice(1).toLowerCase();
      if (pop.open && pop.list[pop.sel] && typed !== pop.list[pop.sel].name) completePop();
      else submit();
    }
  }

  /* ================= Wiring ================= */
  $("msg-input").addEventListener("keydown", onKey);
  $("msg-input").addEventListener("input", function () { updatePop(); updateHint(); autosize(); });
  $("send-btn").addEventListener("click", submit);
  $("members-toggle").addEventListener("click", function () { $("members").classList.toggle("open"); });
  $("jump").addEventListener("click", function () { var b = $("messages"); b.scrollTop = b.scrollHeight; updateJump(); });
  $("messages").addEventListener("scroll", updateJump);
  if (document.addEventListener) {
    document.addEventListener("keydown", function (e) {
      var tag = ((document.activeElement || {}).tagName || "").toUpperCase();
      if (e.key === "/" && !$("app").hidden && tag !== "TEXTAREA" && tag !== "INPUT" && tag !== "SELECT") {
        e.preventDefault(); var i = $("msg-input"); i.focus(); if (!i.value) i.value = "/"; updatePop();
      }
    });
  }

  var timer = null;
  function sync() {
    var admin = isAdmin();
    $("locked").hidden = admin;
    $("app").hidden = !admin;
    $("hud").hidden = !admin;
    clearInterval(timer);
    if (admin) {
      renderMembers(); openChannel(chat.current); refreshLive(); loadAi();
      loadBoard().catch(function (e) { toast("Board: " + e.message, true); });
      timer = setInterval(function () { if (!document.hidden) { refreshLive(); loadAi(); loadBoard().catch(function () {}); } }, 30000);
    } else {
      board = { items: [], log: [], announce: false };
    }
  }

  window.addEventListener("corny-auth", sync);
  sync();
})();

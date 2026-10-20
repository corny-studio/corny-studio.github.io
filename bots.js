/* bots.js — CJC Bots (master only): a paper ledger fed by TradingView alerts through your Worker.
   The Worker stores the fills and does the P&L math; this page only shows it. Nothing here places a real order. */
(function () {
  "use strict";

  // If bots.html is older than this file, say so on screen instead of silently staying locked
  var REQUIRED = ["locked", "app", "hud", "bots-table", "pos-table", "daily-table", "daily-chart", "fills-table", "hook-status", "gen-secret",
                  "secret", "copy-secret", "bot-name", "bot-symbol", "bot-pv", "setup-err", "hook-url", "copy-url", "hook-msg", "copy-msg",
                  "refresh", "send-test", "csv-daily", "csv-fills", "reset-all", "stat-note", "updated", "toast",
                  "name-mode", "strategy-lib", "active-note", "count-all",
                  "tabbtn-paper", "tabbtn-backtest", "tabbtn-setup", "tab-paper", "tab-backtest", "tab-setup", "bt-form"];
  var missingIds = REQUIRED.filter(function (id) { return !document.getElementById(id); });
  if (missingIds.length) {
    var lk = document.getElementById("locked");
    if (lk) { lk.hidden = false; lk.textContent = "bots.html is out of date (missing: " + missingIds.join(", ") + "). Upload the newest bots.html next to bots.js, then hard refresh with Ctrl+Shift+R."; }
    return;
  }

  var cfg = window.CORNY_CONFIG || {};
  var RELAY = (cfg.relayUrl || "").replace(/\/$/, "");
  var POINT_VALUES = { MGC: 10, GC: 100, MES: 5, ES: 50, MNQ: 2, NQ: 20, M2K: 5, RTY: 50, MCL: 100, CL: 1000, SI: 5000 };

  /* ================= Pure helpers (also used by tests) ================= */
  var Lib = {
    pointValueFor: function (symbol) {
      var s = String(symbol).toUpperCase().split(":").pop();
      var m = /^([A-Z0-9]{1,4}?)(?:\d!|[FGHJKMNQUVXZ]\d{1,4})$/.exec(s);
      return (m && POINT_VALUES[m[1]]) || 1;
    },

    // bot === null means "take the name from the strategy" (TradingView fills in {{strategy.order.alert_message}}).
    // Returns { error } or { message }
    buildMessage: function (secret, bot, pv) {
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(secret)) return { error: "Password must be 16-64 letters, numbers, _ or - (use Generate)." };
      if (bot !== null && !/^[A-Za-z0-9 _.-]{1,40}$/.test(bot)) return { error: "Bot name: 1-40 letters, numbers, spaces, _ . -" };
      var n = Number(pv);
      if (!(n > 0 && n <= 1e6)) return { error: "Point value must be a positive number." };
      var name = bot === null ? "{{strategy.order.alert_message}}" : bot;
      return { message: '{"key":"' + secret + '","bot":"' + name + '","symbol":"{{ticker}}","action":"{{strategy.order.action}}","qty":{{strategy.order.contracts}},"price":{{strategy.order.price}},"pv":' + n + '}' };
    },

    csvCell: function (v) {
      var s = String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    },

    // selected = the active bot list, or null when every bot counts
    dailyCsv: function (daily, selected) {
      var rows = ["date_ct,bot,pnl"];
      daily.forEach(function (d) {
        Object.keys(d.bots).sort().forEach(function (b) { rows.push([d.date, Lib.csvCell(b), d.bots[b]].join(",")); });
        rows.push([d.date, selected ? "ACTIVE" : "ALL", d.total].join(","));
        if (selected) rows.push([d.date, "ALL_BOTS", d.totalAll].join(","));
      });
      return rows.join("\n") + "\n";
    },

    fillsCsv: function (fills) {
      var rows = ["time_ct,bot,symbol,side,qty,price,point_value,fee,pnl,position_after"];
      fills.forEach(function (f) {
        rows.push([Lib.ct(f.t), Lib.csvCell(f.bot), Lib.csvCell(f.symbol), f.side, f.qty, f.price, f.pv, f.fee, f.pnl, f.posAfter].join(","));
      });
      return rows.join("\n") + "\n";
    },

    ct: function (t) {
      return new Date(t).toLocaleString("en-CA", { timeZone: "America/Chicago", hour12: false }).replace(",", "");
    },

    cumulative: function (daily) {
      var run = 0;
      return daily.map(function (d) { run += d.total; return { date: d.date, value: Math.round(run * 100) / 100 }; });
    },

    money: function (x) {
      var n = Number(x) || 0, s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return (n < 0 ? "-$" : "$") + s;
    }
  };
  window.BotsLib = Lib;

  /* ================= DOM helpers ================= */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function isAdmin() { return !!(window.Auth && window.Auth.isAdmin()); }
  function sign(x) { return x > 0 ? "pos" : x < 0 ? "neg" : "zero"; }

  var toastTimer = null;
  function toast(msg, bad) {
    var t = $("toast"); t.textContent = msg; t.className = bad ? "bad" : ""; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  function copyText(text, okMsg) {
    function done(ok) { toast(ok ? okMsg : "Copy failed. Select the text and copy it manually.", !ok); }
    function fallback() {
      var t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(t); done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  }

  function download(name, text) {
    var a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(text); a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function api(method, path, body) {
    var opts = { method: method, headers: { "X-Admin-Key": window.Auth.key() }, cache: "no-store" };
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(RELAY + path, opts).then(function (r) {
      if (r.status === 403) throw new Error("Not authorized. Log in again.");
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ("HTTP " + r.status)); });
      return r.json();
    });
  }

  /* ================= Rendering ================= */
  var data = null;

  function table(box, headers, rows, emptyText) {
    box.textContent = "";
    if (!rows.length) { var p = el("div", "empty", emptyText); box.appendChild(p); return; }
    var thead = el("thead"), hr = el("tr");
    headers.forEach(function (h) { hr.appendChild(el("th", h.r ? "r" : "", h.t)); });
    thead.appendChild(hr); box.appendChild(thead);
    var tb = el("tbody");
    rows.forEach(function (cells) {
      var tr = el("tr");
      cells.forEach(function (c, i) {
        var td = el("td", headers[i].r ? "r" : "");
        if (c && typeof c === "object" && c.node) td.appendChild(c.node);
        else { td.textContent = c && typeof c === "object" ? c.t : c; if (c && c.cls) td.className += " " + c.cls; }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    box.appendChild(tb);
  }

  function renderHud() {
    var box = $("hud"); box.textContent = "";
    function chip(k, v, cls) { var c = el("div", "chip"); c.appendChild(el("span", "k", k)); c.appendChild(el("span", "v " + (cls || ""), v)); box.appendChild(c); }
    if (!data) { chip("Status", RELAY ? "Loading…" : "No relay", ""); return; }
    var t = data.totals, sel = data.selection.active;
    chip("Active bot", sel ? (sel.length === 1 ? sel[0] : sel.length + " bots") : "All bots", "zero");
    chip("Total P&L", Lib.money(t.total), sign(t.total));
    chip("Today (CT)", Lib.money(t.today), sign(t.today));
    chip("Realized", Lib.money(t.realized), sign(t.realized));
    chip("Unrealized", Lib.money(t.unrealized), sign(t.unrealized));
    if (data.others.bots > 0) chip("Shadow P&L", Lib.money(data.others.total), sign(data.others.total));
    chip("Open positions", String(t.open), "zero");
    chip("Fills", String(t.fills), "zero");
    chip("Alerts today", data.stat.alertsToday + "/" + data.stat.perDay, "zero");
    chip("Webhook", data.enabled ? "On" : "Off", data.enabled ? "pos" : "neg");
  }

  var STRATEGIES = [
    { name: "EMA Trend", pitch: "Buys when the 20 EMA crosses above the 50 EMA.", likes: "strong trends that last", struggles: "choppy sideways markets (many small losses)" },
    { name: "RSI Mean Reversion", pitch: "Buys when RSI climbs back above 30, only in an uptrend.", likes: "pullbacks and ranges", struggles: "strong one-way trends" },
    { name: "MACD Momentum", pitch: "Buys when MACD crosses above its signal line, with the trend filter.", likes: "swings with clear momentum", struggles: "sideways whipsaws" },
    { name: "Bollinger Bounce", pitch: "Buys when price closes back above the lower band, in an uptrend.", likes: "calm ranges that snap back", struggles: "breakouts that keep going" },
    { name: "Breakout", pitch: "Buys when price breaks the highest high of the last 20 bars.", likes: "big moves after quiet periods", struggles: "fake breakouts" }
  ];

  function renderLibrary() {
    var box = $("strategy-lib"); box.textContent = "";
    STRATEGIES.forEach(function (st) {
      var c = el("div", "libcard");
      c.appendChild(el("h3", "", st.name));
      c.appendChild(el("p", "", st.pitch));
      var l = el("p"); l.appendChild(el("b", "", "Likes: ")); l.appendChild(document.createTextNode(st.likes)); c.appendChild(l);
      var w = el("p"); w.appendChild(el("b", "", "Struggles with: ")); w.appendChild(document.createTextNode(st.struggles)); c.appendChild(w);
      box.appendChild(c);
    });
  }

  function setActive(names) {
    return api("POST", "/bots/active", { active: names }).then(function () { return refresh(); })
      .catch(function (e) { toast(e.message, true); });
  }

  function renderBots() {
    var sel = data.selection.active;
    var byName = {}, names = [];
    data.bots.forEach(function (b) { byName[b.name] = b; names.push(b.name); });
    STRATEGIES.forEach(function (st) { if (names.indexOf(st.name) === -1) names.push(st.name); });
    if (sel) sel.forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); });

    $("active-note").textContent = data.workerOld
      ? "Your Worker is out of date, so choosing an active bot is off. Paste the newest relay-worker.js into Cloudflare and deploy."
      : sel
        ? "Counting only: " + sel.join(", ") + ". Everything else runs as a shadow."
        : "Counting every bot. Make one active below and the rest keep running as shadows.";
    $("count-all").hidden = !sel;

    var rows = names.map(function (name) {
      var b = byName[name];
      var counted = !sel || sel.indexOf(name) > -1;
      var nameCell = el("span"); nameCell.appendChild(document.createTextNode(name));
      nameCell.appendChild(el("span", "badge " + (sel ? (counted ? "on" : "shadow") : "all"), sel ? (counted ? "active" : "shadow") : "counting"));
      var only = !!(sel && counted && sel.length === 1);
      var pick = el("button", "btn small" + (only ? "" : " solid"), only ? "Active" : "Make active"); pick.type = "button";
      pick.disabled = only || !!data.workerOld; pick.setAttribute("aria-label", "Make " + name + " the active bot");
      if (data.workerOld) pick.title = "Update your Worker code first";
      pick.addEventListener("click", function () { setActive([name]); });
      var btns = el("span", "cellbtns"); btns.appendChild(pick);
      if (!b) return [{ node: nameCell }, "—", "—", "—", "0", "—", "no alerts yet", { node: btns }];
      var reset = el("button", "btn small danger", "Reset"); reset.type = "button"; reset.setAttribute("aria-label", "Reset " + b.name);
      reset.addEventListener("click", function () { resetBot(b.name); });
      btns.appendChild(reset);
      var posText = b.positions.length ? b.positions.map(function (p) { return (p.qty > 0 ? "long " : "short ") + Math.abs(p.qty) + " " + p.symbol; }).join(", ") : "flat";
      return [{ node: nameCell }, { t: Lib.money(b.realized), cls: sign(b.realized) }, { t: Lib.money(b.unrealized), cls: sign(b.unrealized) },
              { t: Lib.money(b.total), cls: sign(b.total) }, String(b.trades), b.winRate === null ? "—" : b.winRate + "%", posText, { node: btns }];
    });
    table($("bots-table"), [{ t: "Strategy / bot" }, { t: "Realized", r: 1 }, { t: "Unrealized", r: 1 }, { t: "Total", r: 1 }, { t: "Trades", r: 1 }, { t: "Win %", r: 1 }, { t: "Position" }, { t: "" }],
      rows, "No strategies yet.");
  }

  function renderPositions() {
    var rows = [];
    data.bots.forEach(function (b) {
      b.positions.forEach(function (p) {
        rows.push([b.name, p.symbol, { t: (p.qty > 0 ? "+" : "") + p.qty, cls: p.qty > 0 ? "pos" : "neg" }, String(p.avg), String(p.last), { t: Lib.money(p.unrealized), cls: sign(p.unrealized) }]);
      });
    });
    table($("pos-table"), [{ t: "Bot" }, { t: "Symbol" }, { t: "Qty", r: 1 }, { t: "Avg", r: 1 }, { t: "Last", r: 1 }, { t: "Unrealized", r: 1 }], rows, "Nothing open.");
  }

  function renderChart() {
    var svg = $("daily-chart"); svg.textContent = "";
    var pts = Lib.cumulative(data.daily);
    var ns = "http://www.w3.org/2000/svg";
    function mk(tag, attrs) { var n = document.createElementNS ? document.createElementNS(ns, tag) : document.createElement(tag); Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); }); return n; }
    if (pts.length < 2) {
      var t = mk("text", { x: 300, y: 80, "text-anchor": "middle", fill: "#6d8294", "font-size": 13 }); t.textContent = pts.length ? "One trading day so far" : "No daily P&L yet"; svg.appendChild(t); return;
    }
    var vals = pts.map(function (p) { return p.value; }).concat([0]);
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), span = (max - min) || 1;
    function x(i) { return 20 + (560 * i) / (pts.length - 1); }
    function y(v) { return 130 - ((v - min) / span) * 110; }
    svg.appendChild(mk("line", { x1: 20, x2: 580, y1: y(0), y2: y(0), stroke: "#243241", "stroke-dasharray": "4 4" }));
    var last = pts[pts.length - 1].value;
    svg.appendChild(mk("polyline", { points: pts.map(function (p, i) { return x(i).toFixed(1) + "," + y(p.value).toFixed(1); }).join(" "), fill: "none", stroke: last >= 0 ? "#39ff14" : "#ff5c7a", "stroke-width": 2 }));
    var lbl = mk("text", { x: 580, y: 14, "text-anchor": "end", fill: "#cfe6f2", "font-size": 12 }); lbl.textContent = Lib.money(last); svg.appendChild(lbl);
  }

  function renderDaily() {
    renderChart();
    var rows = data.daily.slice().reverse().slice(0, 30).map(function (d) {
      var parts = Object.keys(d.bots).sort().map(function (b) { return b + " " + Lib.money(d.bots[b]); }).join(" · ");
      return [d.date, { t: Lib.money(d.total), cls: sign(d.total) }, { t: Lib.money(d.totalAll), cls: sign(d.totalAll) }, parts];
    });
    table($("daily-table"), [{ t: "Date (CT)" }, { t: "Counted", r: 1 }, { t: "All bots", r: 1 }, { t: "By bot" }], rows, "No closed trades yet.");
  }

  function renderFills() {
    var rows = data.recent.map(function (f) {
      var sideNode = el("span", "side-" + f.side, f.side); if (f.manual) sideNode.appendChild(el("span", "tag", "manual"));
      return [Lib.ct(f.t), f.bot, f.symbol, { node: sideNode }, String(f.qty), String(f.price), { t: f.note ? f.note : Lib.money(f.pnl), cls: f.note ? "" : sign(f.pnl) }, String(f.posAfter)];
    });
    table($("fills-table"), [{ t: "Time (CT)" }, { t: "Bot" }, { t: "Symbol" }, { t: "Side" }, { t: "Qty", r: 1 }, { t: "Price", r: 1 }, { t: "P&L", r: 1 }, { t: "Pos after", r: 1 }], rows, "No fills yet.");
  }

  function renderStatus() {
    var s = $("hook-status");
    if (!RELAY) { s.className = "off"; s.textContent = "No relay: set relayUrl in config.js first. TradingView needs your Worker's public address."; return; }
    if (!data) { s.className = "off"; s.textContent = "Checking the Worker…"; return; }
    if (data.enabled) { s.className = "on"; s.textContent = "Webhook is ON. Alerts with the right password will land in the ledger."; }
    else { s.className = "off"; s.textContent = "Webhook is OFF. Add the secret BOT_WEBHOOK_SECRET (the password in step 1) to your Worker's Production settings, then deploy."; }
    var st = data.stat;
    $("stat-note").textContent = "Stored fills: " + st.stored + " of " + st.maxFills + ". Alerts today: " + st.alertsToday + " of " + st.perDay + "." +
      (data.truncated ? " The ledger is too big to show fully: export a CSV and reset." : "") +
      " Cloudflare's free storage allows about 1,000 writes a day across your whole Worker, so keep alert counts modest.";
  }

  function renderAll() {
    renderHud(); renderStatus(); updateSetup();
    if (!data) return;
    renderBots(); renderPositions(); renderDaily(); renderFills();
    $("updated").textContent = "paper ledger · not real money · updated " + new Date().toTimeString().slice(0, 8);
  }

  /* ================= Setup panel ================= */
  var pvTouched = false;

  function genToken() {
    var a = new Uint8Array(24); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  function updateSetup() {
    var auto = $("name-mode").value !== "own";
    $("bot-name").disabled = auto;
    $("hook-url").value = RELAY ? RELAY + "/bots/hook" : "";
    var r = Lib.buildMessage($("secret").value.trim(), auto ? null : $("bot-name").value.trim(), $("bot-pv").value.trim());
    $("setup-err").textContent = $("secret").value.trim() || r.message ? (r.error || "") : "";
    $("hook-msg").value = r.message || "";
  }

  /* ================= Actions ================= */
  var oldWarned = false;
  function refresh() {
    return api("GET", "/bots").then(function (j) {
      // A Worker deployed before the "choose the active bot" update doesn't send these fields. Fill them in so the page still works.
      j.workerOld = !j.selection || !j.others;
      if (!j.selection) j.selection = { active: null };
      if (!j.others) j.others = { realized: 0, unrealized: 0, total: 0, bots: 0 };
      (j.daily || []).forEach(function (d) { if (d.totalAll === undefined) d.totalAll = d.total; });
      data = j; renderAll();
      if (j.workerOld && !oldWarned) {
        oldWarned = true;
        toast("Your Worker code is older than this page. Paste the newest relay-worker.js into Cloudflare and deploy to turn on Make active.", true);
      }
    }).catch(function (e) { toast("Bots: " + e.message, true); });
  }

  function sendTest() {
    api("POST", "/bots/fill", { bot: "TEST", symbol: "TEST", action: "buy", qty: 1, price: 100, pv: 1 })
      .then(function () { toast("Test fill added to a bot named TEST. Use its Reset button when you're done."); return refresh(); })
      .catch(function (e) { toast(e.message, true); });
  }

  function resetBot(name) {
    if (!confirm('Delete every fill for "' + name + '"? This cannot be undone.')) return;
    api("POST", "/bots/reset", { bot: name, confirm: true }).then(function () { toast("Reset " + name + "."); return refresh(); })
      .catch(function (e) { toast(e.message, true); });
  }

  function resetAll() {
    if (!confirm("Delete the whole ledger (every bot, every fill)? Export your CSV first. This cannot be undone.")) return;
    api("POST", "/bots/reset", { confirm: true }).then(function () { toast("Ledger cleared."); return refresh(); })
      .catch(function (e) { toast(e.message, true); });
  }

  function exportFills() {
    api("GET", "/bots/fills").then(function (j) { download("cjc-bots-fills.csv", Lib.fillsCsv(j.fills)); })
      .catch(function (e) { toast(e.message, true); });
  }

  /* ================= Tabs ================= */
  var TABS = ["paper", "backtest", "setup"];
  function showTab(name) {
    if (TABS.indexOf(name) === -1) name = "paper";
    TABS.forEach(function (t) {
      $("tab-" + t).hidden = t !== name;
      $("tabbtn-" + t).className = "tabbtn" + (t === name ? " active" : "");
    });
    try { sessionStorage.setItem("corny_bots_tab", name); } catch (e) {}
  }
  TABS.forEach(function (t) { $("tabbtn-" + t).addEventListener("click", function () { showTab(t); }); });
  var savedTab = null; try { savedTab = sessionStorage.getItem("corny_bots_tab"); } catch (e) {}
  showTab(savedTab);

  // lets the backtest tab pick the active strategy and refresh this page
  window.BotsApp = { setActive: setActive, refresh: refresh, showTab: showTab };

  /* ================= Wiring ================= */
  $("refresh").addEventListener("click", refresh);
  $("count-all").addEventListener("click", function () { setActive(null); });
  $("name-mode").addEventListener("change", updateSetup);
  $("send-test").addEventListener("click", sendTest);
  $("reset-all").addEventListener("click", resetAll);
  $("csv-fills").addEventListener("click", exportFills);
  $("csv-daily").addEventListener("click", function () {
    if (!data || !data.daily.length) { toast("No daily P&L to export yet.", true); return; }
    download("cjc-bots-daily-pnl.csv", Lib.dailyCsv(data.daily, data.selection.active));
  });
  $("gen-secret").addEventListener("click", function () { $("secret").value = genToken(); updateSetup(); toast("Password made. Copy it into Cloudflare as BOT_WEBHOOK_SECRET."); });
  $("copy-secret").addEventListener("click", function () { if ($("secret").value) copyText($("secret").value, "Password copied."); });
  $("copy-url").addEventListener("click", function () { if ($("hook-url").value) copyText($("hook-url").value, "Webhook URL copied."); });
  $("copy-msg").addEventListener("click", function () { if ($("hook-msg").value) copyText($("hook-msg").value, "Message copied."); });
  ["secret", "bot-name"].forEach(function (id) { $(id).addEventListener("input", updateSetup); });
  $("bot-symbol").addEventListener("input", function () { if (!pvTouched) { $("bot-pv").value = String(Lib.pointValueFor($("bot-symbol").value.trim())); } updateSetup(); });
  $("bot-pv").addEventListener("input", function () { pvTouched = true; updateSetup(); });

  var timer = null;
  function sync() {
    var admin = isAdmin();
    $("locked").hidden = admin; $("app").hidden = !admin; $("hud").hidden = !admin;
    clearInterval(timer);
    if (admin) {
      renderLibrary(); renderAll();
      if (RELAY) { refresh(); timer = setInterval(function () { if (!document.hidden) refresh(); }, 120000); }
    } else { data = null; }
  }

  window.addEventListener("corny-auth", sync);
  sync();
})();

/* backtest.js — the Backtest tab on your Bots page (master only).
   Load candles (Coinbase automatically, or any market from a CSV), set the same options as the TradingView script,
   run the backtest, see where slippage kills it, compare all six strategies, and press "Make active" on the winner.
   The maths lives in bt-engine.js. Nothing here places an order, and nothing is saved on a server. */
(function () {
  "use strict";

  var IDS = ["bt-src", "bt-cb", "bt-csv", "bt-product", "bt-tf", "bt-bars", "bt-file", "bt-load", "bt-datastatus", "bt-form", "bt-run",
             "bt-compare-btn", "bt-copy", "bt-reset", "bt-results", "bt-title", "bt-hud", "bt-chart", "bt-ladder", "bt-warn",
             "bt-compare-card", "bt-compare", "bt-trades-card", "bt-trades", "opt-box", "toast"];
  // an older bots.html is explained by bots.js, so just stay quiet here
  if (IDS.some(function (id) { return !document.getElementById(id); })) return;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  var cfg = window.CORNY_CONFIG || {};
  var RELAY = (cfg.relayUrl || "").replace(/\/$/, "");

  if (!window.BT) {
    $("bt-datastatus").textContent = "bt-engine.js is missing. Upload it next to bots.js, then hard refresh with Ctrl+Shift+R.";
    ["bt-load", "bt-run", "bt-compare-btn", "bt-copy", "bt-reset"].forEach(function (id) { $(id).disabled = true; });
    return;
  }
  var BT = window.BT;

  var toastTimer = null;
  function toast(msg, bad) {
    var t = $("toast"); t.textContent = msg; t.className = bad ? "bad" : ""; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 4200);
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

  /* ================= Pure helpers (also used by tests) ================= */
  function money(x) {
    var n = Number(x) || 0, s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? "-$" : "$") + s;
  }
  function pct(x, d) { return (x === null || x === undefined || x !== x) ? "—" : (Math.round(x * Math.pow(10, d == null ? 1 : d)) / Math.pow(10, d == null ? 1 : d)).toFixed(d == null ? 1 : d) + "%"; }
  function sign(x) { return x > 0 ? "pos" : x < 0 ? "neg" : "zero"; }
  function dateOf(t) { return new Date(t).toISOString().slice(0, 16).replace("T", " "); }

  // The same options as the Pine script, with the Pine input labels so you can match them in TradingView
  var SLIPS = [0, 0.01, 0.02, 0.05, 0.1, 0.3, 0.5, 1, 3, 4, 5];
  var FIELDS = [
    { g: "main", key: "mode", label: "Strategy", type: "select", options: BT.MODES.map(function (m) { return [m, m]; }) },
    { g: "main", key: "slipPct", label: "Slippage per market/stop order (% of price)", type: "select", num: true, options: SLIPS.map(function (v) { return [String(v), v + "%"]; }) },
    { g: "main", key: "feePct", label: "Trading fee per order (%)", min: 0, max: 5, step: 0.01 },
    { g: "main", key: "capital", label: "Starting money ($)", min: 100, max: 1e9, step: 100 },
    { g: "main", key: "riskPct", label: "Risk per trade (% of money)", min: 0.05, max: 10, step: 0.05 },
    { g: "main", key: "stopMult", label: "Stop distance (x ATR)", min: 0.5, max: 10, step: 0.1 },
    { g: "main", key: "rr", label: "Reward : Risk (final target)", min: 0.5, max: 10, step: 0.1 },
    { g: "main", key: "atrLen", label: "ATR length", int: true, min: 1, max: 200 },
    { g: "main", key: "trendLen", label: "Trend filter EMA (0 = off)", int: true, min: 0, max: 1000 },
    { g: "main", key: "maxLeverage", label: "Max leverage (x)", min: 0.1, max: 20, step: 0.1 },
    { g: "main", key: "pv", label: "Point value (1 for crypto, 10 for MGC)", min: 0.0001, max: 1e6, step: "any" },
    { g: "main", key: "wholeUnits", label: "Whole contracts only (futures)", type: "check" },
    { g: "main", key: "allowShort", label: "Allow shorts", type: "check" },

    { g: "details", key: "vwFast", label: "VWAP strategy fast EMA", int: true, min: 2, max: 500 },
    { g: "details", key: "vwSlow", label: "VWAP strategy slow EMA", int: true, min: 3, max: 1000 },
    { g: "details", key: "vwapSession", label: "VWAP restarts each (utc = calendar day, ny18 = futures day at 6pm New York)", type: "select", options: [["utc", "UTC day (crypto)"], ["ny18", "Futures day (6pm New York)"]] },
    { g: "details", key: "fastLen", label: "Fast EMA", int: true, min: 2, max: 500 },
    { g: "details", key: "slowLen", label: "Slow EMA", int: true, min: 3, max: 1000 },
    { g: "details", key: "rsiLen", label: "RSI length", int: true, min: 2, max: 200 },
    { g: "details", key: "rsiBuy", label: "Oversold level (buy when RSI climbs back above)", min: 5, max: 50 },
    { g: "details", key: "rsiSell", label: "Overbought level (sell when RSI drops back below)", min: 50, max: 95 },
    { g: "details", key: "macdFast", label: "MACD fast length", int: true, min: 2, max: 200 },
    { g: "details", key: "macdSlow", label: "MACD slow length", int: true, min: 3, max: 400 },
    { g: "details", key: "macdSig", label: "MACD signal length", int: true, min: 2, max: 200 },
    { g: "details", key: "bbLen", label: "Bollinger length", int: true, min: 5, max: 400 },
    { g: "details", key: "bbMult", label: "Bollinger width (std devs)", min: 0.5, max: 5, step: 0.1 },
    { g: "details", key: "brkLen", label: "Breakout lookback (bars)", int: true, min: 5, max: 500 },

    { g: "hours", key: "useSession", label: "Only open trades inside this window (New York time)", type: "check" },
    { g: "hours", key: "sessStart", label: "Window starts (New York hour, 8.5 = 8:30)", min: 0, max: 24, step: 0.25 },
    { g: "hours", key: "sessEnd", label: "Window ends (New York hour)", min: 0, max: 24, step: 0.25 },
    { g: "hours", key: "flatAtEnd", label: "Close the trade when the window ends", type: "check" },

    { g: "protect", key: "useBE", label: "Move stop to break-even", type: "check" },
    { g: "protect", key: "beR", label: "...once price has moved this many x the risk", min: 0.2, max: 10, step: 0.1 },
    { g: "protect", key: "beBufATR", label: "Break-even buffer (x ATR, locks a tiny profit)", min: 0, max: 5, step: 0.05 },
    { g: "protect", key: "useTrail", label: "Trail the stop (only ever tightens)", type: "check" },
    { g: "protect", key: "trailStart", label: "...starts once price has moved this many x the risk", min: 0.2, max: 10, step: 0.1 },
    { g: "protect", key: "trailATR", label: "Trail distance (x ATR behind the best price)", min: 0.5, max: 10, step: 0.1 },
    { g: "protect", key: "noTarget", label: "No fixed target while trailing (let winners run)", type: "check" },
    { g: "protect", key: "usePartial", label: "Take partial profit", type: "check" },
    { g: "protect", key: "partialR", label: "...at this many x the risk", min: 0.2, max: 10, step: 0.1 },
    { g: "protect", key: "partialPct", label: "...close this % of the position", min: 10, max: 90, step: 5 }
  ];

  // Quick starting points for common markets. Futures need whole contracts and margin, not the full contract value.
  var PRESETS = [
    { id: "custom", label: "Custom (keep my numbers)" },
    { id: "crypto", label: "Crypto spot (Coinbase)", v: { pv: 1, wholeUnits: false, maxLeverage: 1, feePct: 0.1, vwapSession: "utc" } },
    { id: "mgc", label: "MGC micro gold futures (10 oz)", v: { pv: 10, wholeUnits: true, maxLeverage: 10, feePct: 0.005, vwapSession: "ny18" } },
    { id: "mes", label: "MES micro S&P 500 futures", v: { pv: 5, wholeUnits: true, maxLeverage: 10, feePct: 0.005, vwapSession: "ny18" } },
    { id: "mnq", label: "MNQ micro Nasdaq futures", v: { pv: 2, wholeUnits: true, maxLeverage: 10, feePct: 0.005, vwapSession: "ny18" } },
    { id: "es", label: "ES E-mini S&P 500 futures", v: { pv: 50, wholeUnits: true, maxLeverage: 10, feePct: 0.005, vwapSession: "ny18" } },
    { id: "nq", label: "NQ E-mini Nasdaq futures", v: { pv: 20, wholeUnits: true, maxLeverage: 10, feePct: 0.005, vwapSession: "ny18" } }
  ];

  // Returns { P } or { error } from a plain object of raw values
  function validate(raw) {
    var P = Object.assign(BT.defaults(), raw);
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i], v = P[f.key];
      if (f.type === "check" || f.type === "select") continue;
      if (typeof v !== "number" || !isFinite(v) || v < f.min || v > f.max) return { error: f.label + " must be a number between " + f.min + " and " + f.max + "." };
      if (f.int && Math.floor(v) !== v) return { error: f.label + " must be a whole number." };
    }
    if (BT.MODES.indexOf(P.mode) === -1) return { error: "Pick one of the strategies in the list." };
    if (P.fastLen >= P.slowLen) return { error: "Fast EMA must be shorter than Slow EMA." };
    if (P.vwFast >= P.vwSlow) return { error: "The VWAP strategy's fast EMA must be shorter than its slow EMA." };
    if (P.macdFast >= P.macdSlow) return { error: "MACD fast length must be shorter than the slow length." };
    if (P.rsiBuy >= P.rsiSell) return { error: "The oversold level must be below the overbought level." };
    if (P.useSession && P.sessStart === P.sessEnd) return { error: "The trading window can't start and end at the same time." };
    return { P: P };
  }

  function hhmm(x) { var h = Math.floor(x), m = Math.round((x - h) * 60); return (h < 10 ? "0" : "") + h + (m < 10 ? "0" : "") + m; }

  // The settings to type into the TradingView script so it matches this backtest
  function tvSettings(P) {
    var L = ["CORNY Multi-Strategy v4: set these in the script's Inputs tab", "", "Strategy: " + P.mode];
    if (P.mode === "EMA VWAP") L.push("VWAP strategy fast EMA: " + P.vwFast, "VWAP strategy slow EMA: " + P.vwSlow, "(use an intraday chart: VWAP restarts every session)");
    if (P.mode === "EMA Trend") L.push("Fast EMA: " + P.fastLen, "Slow EMA: " + P.slowLen);
    if (P.mode === "RSI Mean Reversion") L.push("RSI length: " + P.rsiLen, "Oversold level (buy when RSI climbs back above): " + P.rsiBuy, "Overbought level (sell when RSI drops back below): " + P.rsiSell);
    if (P.mode === "MACD Momentum") L.push("MACD fast length: " + P.macdFast, "MACD slow length: " + P.macdSlow, "MACD signal length: " + P.macdSig);
    if (P.mode === "Bollinger Bounce") L.push("Bollinger length: " + P.bbLen, "Bollinger width (std devs): " + P.bbMult);
    if (P.mode === "Breakout") L.push("Breakout lookback (bars): " + P.brkLen);
    if (P.mode !== "EMA Trend" && P.mode !== "Breakout") L.push("Trend filter EMA (0 = off): " + P.trendLen);
    L.push("", "ATR length: " + P.atrLen, "Stop distance (x ATR): " + P.stopMult, "Reward : Risk (final target): " + P.rr,
           "Risk per trade (% of equity): " + P.riskPct, "Allow shorts: " + (P.allowShort ? "on" : "off"),
           "Slippage per market/stop order (% of price): " + P.slipPct, "");
    L.push("Only open trades inside this window (New York time): " + (P.useSession ? "on" : "off"));
    if (P.useSession) L.push("Window: " + hhmm(P.sessStart) + "-" + hhmm(P.sessEnd), "Close the trade when the window ends: " + (P.flatAtEnd ? "on" : "off"));
    L.push("Move stop to break-even: " + (P.useBE ? "on (after " + P.beR + "x risk, buffer " + P.beBufATR + " ATR)" : "off"));
    L.push("Trail the stop: " + (P.useTrail ? "on (starts at " + P.trailStart + "x risk, " + P.trailATR + " ATR behind" + (P.noTarget ? ", no fixed target" : "") + ")" : "off"));
    L.push("Take partial profit: " + (P.usePartial ? "on (" + P.partialPct + "% at " + P.partialR + "x risk)" : "off"));
    L.push("", "Also in TradingView: Settings > Properties > Initial capital " + P.capital + ", Commission " + P.feePct + "%.",
           "Max leverage and whole-contracts are only in this backtester; TradingView uses its own margin settings.");
    return L.join("\n");
  }

  function warnings(P, m, be, n) {
    var w = [];
    if (m.skipped > 0) w.push(m.skipped + " signal" + (m.skipped === 1 ? " was" : "s were") + " skipped because even one " + (P.wholeUnits ? "contract" : "unit") + " costs more than your money allows at " + P.maxLeverage + "x leverage. Raise Max leverage or Starting money (futures only need a small margin, so a cap around 10x is typical).");
    if (m.trades === 0 && m.skipped === 0) w.push("No trades closed. Try more bars or a different strategy.");
    if (m.trades < 50) w.push("Only " + m.trades + " closed trades. That is too few to trust: load more bars or use a smaller timeframe.");
    if (m.net <= 0) w.push("It loses money at " + P.slipPct + "% slippage" + (be.text ? " (break-even is " + be.text + ")" : "") + ".");
    else if (be.value !== null && be.value < 0.3) w.push("It stops making money below 0.3% slippage, which real trading easily costs. Treat it with suspicion.");
    if (m.buyHoldPct === m.buyHoldPct && m.net / P.capital * 100 < m.buyHoldPct) w.push("Just holding would have returned " + pct(m.buyHoldPct) + " over the same bars, more than this strategy.");
    w.push("Fees and slippage cost " + money(m.fees + m.slipPaid) + " in total (" + pct((m.fees + m.slipPaid) / P.capital * 100) + " of your starting money).");
    return w.join(" ");
  }

  window.BtUI = { validate: validate, tvSettings: tvSettings, warnings: warnings, FIELDS: FIELDS, money: money, PRESETS: PRESETS };

  /* ================= The settings form ================= */
  var controls = {};
  var FORM_KEY = "corny_bt_form";

  function buildForm() {
    var form = $("bt-form"); form.textContent = "";
    var main = el("div", "formgrid"); form.appendChild(main);
    var boxes = { main: main };
    var pw = el("label"); pw.appendChild(document.createTextNode("Market preset (sets point value, contracts, leverage and fee)"));
    var ps = el("select"); ps.id = "btf-preset"; ps.setAttribute("aria-label", "Market preset");
    PRESETS.forEach(function (p) { var op = el("option", "", p.label); op.value = p.id; ps.appendChild(op); });
    ps.value = "custom"; pw.appendChild(ps); main.appendChild(pw); controls.preset = ps;
    ps.addEventListener("change", function () { applyPreset(ps.value); });
    [["details", "Strategy details (lengths and levels for each strategy)"], ["hours", "Trading hours (only trade inside a New York time window)"], ["protect", "Profit protection (break-even, trailing stop, partial profit)"]].forEach(function (g) {
      var d = el("details"); d.appendChild(el("summary", "", g[1]));
      var grid = el("div", "formgrid"); d.appendChild(grid); form.appendChild(d); boxes[g[0]] = grid;
    });
    FIELDS.forEach(function (f) {
      var wrap = el("label", f.type === "check" ? "check" : ""), input;
      if (f.type === "select") {
        input = el("select");
        f.options.forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; input.appendChild(op); });
      } else if (f.type === "check") {
        input = el("input"); input.type = "checkbox";
      } else {
        input = el("input"); input.type = "number"; input.step = String(f.step || 1); input.setAttribute("inputmode", "decimal");
      }
      input.id = "btf-" + f.key; input.setAttribute("aria-label", f.label);
      if (f.type === "check") { wrap.appendChild(input); wrap.appendChild(document.createTextNode(f.label)); }
      else { wrap.appendChild(document.createTextNode(f.label)); wrap.appendChild(input); }
      boxes[f.g].appendChild(wrap);
      controls[f.key] = input;
    });
    setForm(BT.defaults());
  }

  function applyPreset(id) {
    var p = PRESETS.filter(function (x) { return x.id === id; })[0];
    if (!p || !p.v) return;
    Object.keys(p.v).forEach(function (k) {
      var c = controls[k]; if (!c) return;
      if (typeof p.v[k] === "boolean") c.checked = p.v[k]; else c.value = String(p.v[k]);
    });
    toast(p.label + " settings applied. Check Starting money and risk still suit you.");
  }

  function setForm(P) {
    FIELDS.forEach(function (f) {
      var c = controls[f.key], v = P[f.key];
      if (v === undefined) return;
      if (f.type === "check") c.checked = !!v; else c.value = String(v);
    });
  }

  function readForm() {
    var raw = {};
    FIELDS.forEach(function (f) {
      var c = controls[f.key];
      if (f.type === "check") raw[f.key] = !!c.checked;
      else if (f.type === "select") raw[f.key] = f.num ? Number(c.value) : c.value;
      else raw[f.key] = c.value === "" ? NaN : Number(c.value);
    });
    return validate(raw);
  }

  function saveForm() {
    var out = { data: { src: $("bt-src").value, product: $("bt-product").value, tf: $("bt-tf").value, bars: $("bt-bars").value, preset: controls.preset.value }, form: {} };
    FIELDS.forEach(function (f) { out.form[f.key] = f.type === "check" ? !!controls[f.key].checked : controls[f.key].value; });
    try { localStorage.setItem(FORM_KEY, JSON.stringify(out)); } catch (e) {}
  }

  function restoreForm() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(FORM_KEY) || "null"); } catch (e) {}
    if (!saved || !saved.form) return;
    FIELDS.forEach(function (f) {
      var v = saved.form[f.key]; if (v === undefined) return;
      if (f.type === "check") controls[f.key].checked = !!v; else controls[f.key].value = String(v);
    });
    if (saved.data && saved.data.preset) controls.preset.value = saved.data.preset;
    if (saved.data) { $("bt-src").value = saved.data.src || "cb"; $("bt-product").value = saved.data.product || "ONDO-USD"; $("bt-tf").value = saved.data.tf || "3600"; $("bt-bars").value = saved.data.bars || "3000"; }
  }

  /* ================= Price data ================= */
  var candles = null, dataInfo = "";
  var CB = "https://api.exchange.coinbase.com";
  var TF_NAMES = { "900": "15m", "3600": "1h", "21600": "6h", "86400": "1d" };

  function setStatus(text) { $("bt-datastatus").textContent = text; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function dataLoaded(list, label) {
    candles = list;
    dataInfo = label + " · " + list.length.toLocaleString() + " bars · " + dateOf(list[0].t).slice(0, 10) + " to " + dateOf(list[list.length - 1].t).slice(0, 10);
    setStatus(dataInfo);
    $("bt-results").hidden = true; $("bt-compare-card").hidden = true; $("bt-trades-card").hidden = true;
    optReset(); if (opt.els.count) updateCount();
  }

  async function loadCoinbase() {
    var product = $("bt-product").value.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,10}-[A-Z]{2,5}$/.test(product)) { toast("Use a Coinbase product like ONDO-USD or BTC-USD.", true); return; }
    var gran = Number($("bt-tf").value), want = Number($("bt-bars").value), rows = [], end = Date.now(), guard = 0;
    $("bt-load").disabled = true;
    try {
      while (rows.length < want && guard++ < 40) {
        var start = end - 300 * gran * 1000;
        var url = CB + "/products/" + encodeURIComponent(product) + "/candles?granularity=" + gran + "&start=" + new Date(start).toISOString() + "&end=" + new Date(end).toISOString();
        var r = await fetch(url);
        if (!r.ok) throw new Error(r.status === 404 ? "Coinbase doesn't list " + product + "." : "Coinbase answered " + r.status + ".");
        var j = await r.json();
        if (!Array.isArray(j) || !j.length) break;
        rows = rows.concat(j); end = start;
        setStatus("Loading " + product + "… " + rows.length.toLocaleString() + " bars");
        await sleep(160);
      }
      var list = BT.fromCoinbase(rows);
      if (list.length < 100) throw new Error("Only " + list.length + " bars came back. Try a bigger timeframe, or use the CSV option.");
      dataLoaded(list.slice(-want), product + " " + TF_NAMES[String(gran)]);
      toast("Loaded " + list.length.toLocaleString() + " bars.");
    } catch (e) {
      setStatus("Couldn't load data");
      toast((e && e.message ? e.message : "Network error") + " If your browser blocked the request, export a CSV from TradingView and use that instead.", true);
    }
    $("bt-load").disabled = false;
  }

  async function loadCsv() {
    var f = $("bt-file").files && $("bt-file").files[0];
    if (!f) { toast("Choose a CSV file first.", true); return; }
    try {
      var r = BT.fromCsv(await f.text());
      if (r.error) { setStatus("Couldn't read that file"); toast(r.error, true); return; }
      dataLoaded(r.candles, "CSV file" + (r.hasVolume ? "" : " (no volume column: VWAP counts every bar equally)"));
      toast("Loaded " + r.candles.length.toLocaleString() + " bars from your file.");
    } catch (e) { toast("Couldn't read that file: " + e.message, true); }
  }

  function loadData() { return $("bt-src").value === "csv" ? loadCsv() : loadCoinbase(); }

  /* ================= Rendering ================= */
  function table(box, headers, rows) {
    box.textContent = "";
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

  function chip(box, k, v, cls) { var c = el("div", "chip"); c.appendChild(el("span", "k", k)); c.appendChild(el("span", "v " + (cls || ""), v)); box.appendChild(c); }

  function drawChart(equity, P) {
    var svg = $("bt-chart"); svg.textContent = "";
    var ns = "http://www.w3.org/2000/svg";
    function mk(tag, attrs) { var n = document.createElementNS ? document.createElementNS(ns, tag) : document.createElement(tag); Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); }); return n; }
    var bh = candles.map(function (c) { return P.capital * c.c / candles[0].c; });
    var all = equity.concat(bh), min = Math.min.apply(null, all), max = Math.max.apply(null, all), span = (max - min) || 1, n = equity.length;
    function pts(arr) { var step = Math.max(1, Math.floor(n / 400)), out = []; for (var i = 0; i < n; i += step) out.push((20 + 560 * i / (n - 1)).toFixed(1) + "," + (135 - (arr[i] - min) / span * 115).toFixed(1)); return out.join(" "); }
    svg.appendChild(mk("line", { x1: 20, x2: 580, y1: (135 - (P.capital - min) / span * 115).toFixed(1), y2: (135 - (P.capital - min) / span * 115).toFixed(1), stroke: "#243241", "stroke-dasharray": "4 4" }));
    svg.appendChild(mk("polyline", { points: pts(bh), fill: "none", stroke: "#6d8294", "stroke-width": 1, "stroke-dasharray": "3 3" }));
    var last = equity[n - 1];
    svg.appendChild(mk("polyline", { points: pts(equity), fill: "none", stroke: last >= P.capital ? "#39ff14" : "#ff5c7a", "stroke-width": 2 }));
    var lbl = mk("text", { x: 580, y: 14, "text-anchor": "end", fill: "#cfe6f2", "font-size": 12 }); lbl.textContent = money(last) + "  (dashed = just holding)"; svg.appendChild(lbl);
  }

  function show(P, res, lad) {
    var m = res.metrics;
    $("bt-results").hidden = false; $("bt-trades-card").hidden = false;
    $("bt-title").textContent = P.mode + " · " + dataInfo;
    var hud = $("bt-hud"); hud.textContent = "";
    chip(hud, "Net after costs", money(m.net), sign(m.net));
    chip(hud, "Return", pct(m.returnPct), sign(m.returnPct));
    chip(hud, "Trades", String(m.trades), "zero");
    chip(hud, "Win rate", pct(m.winRate, 0), "zero");
    chip(hud, "Profit factor", m.profitFactor === Infinity ? "∞" : (m.profitFactor === m.profitFactor ? m.profitFactor.toFixed(2) : "—"), "zero");
    chip(hud, "Max drawdown", pct(m.maxDDpct), m.maxDDpct > 25 ? "neg" : "zero");
    chip(hud, "Break-even slippage", lad.breakEven.text, lad.breakEven.value !== null && lad.breakEven.value >= 0.5 ? "pos" : "neg");
    chip(hud, "Just holding", pct(m.buyHoldPct), sign(m.buyHoldPct));
    drawChart(res.equity, P);

    table($("bt-ladder"), [{ t: "Slippage per order" }, { t: "Net P&L", r: 1 }, { t: "Trades", r: 1 }, { t: "Max drawdown", r: 1 }, { t: "Win rate", r: 1 }],
      lad.rows.map(function (r) {
        var mark = r.slip === P.slipPct ? "  ← your setting" : "";
        return [r.slip + "%" + mark, { t: money(r.net), cls: sign(r.net) }, String(r.trades), pct(r.maxDDpct), pct(r.winRate, 0)];
      }));
    $("bt-warn").textContent = warnings(P, m, lad.breakEven);

    var tr = res.trades.slice(-100).reverse().map(function (t) {
      return [dateOf(candles[t.exitBar].t), t.dir > 0 ? "long" : "short", String(Math.round(t.qty * 1e6) / 1e6), String(Math.round(t.entry * 1e6) / 1e6), String(Math.round(t.exit * 1e6) / 1e6), { t: money(t.pnl), cls: sign(t.pnl) }, t.reason];
    });
    table($("bt-trades"), [{ t: "Closed" }, { t: "Side" }, { t: "Qty", r: 1 }, { t: "Entry", r: 1 }, { t: "Exit", r: 1 }, { t: "P&L", r: 1 }, { t: "Why" }],
      tr.length ? tr : [["No closed trades", "", "", "", "", "", ""]]);
  }

  /* ================= Actions ================= */
  function busy(on) { ["bt-run", "bt-compare-btn", "bt-load"].forEach(function (id) { $(id).disabled = on; }); }

  function prepare() {
    var r = readForm();
    if (r.error) { toast(r.error, true); return null; }
    if (!candles) { toast("Load price data first (step 1).", true); return null; }
    saveForm();
    return r.P;
  }

  function run() {
    var P = prepare(); if (!P) return;
    busy(true); setStatus(dataInfo + " · running…");
    setTimeout(function () {
      try { show(P, BT.run(candles, P), BT.ladder(candles, P)); }
      catch (e) { toast("Backtest failed: " + e.message, true); }
      setStatus(dataInfo); busy(false);
    }, 30);
  }

  function makeActive(mode) {
    if (!RELAY) { toast("Set relayUrl in config.js first. The active bot is saved on your Worker.", true); return; }
    if (!window.BotsApp) { toast("Open the Paper ledger tab once, then try again.", true); return; }
    window.BotsApp.setActive([mode]).then(function () { toast(mode + " is now the active bot on your Paper ledger."); });
  }

  function runMode(mode) { controls.mode.value = mode; run(); window.scrollTo && window.scrollTo(0, 0); }

  function compareAll() {
    var P = prepare(); if (!P) return;
    busy(true); setStatus(dataInfo + " · comparing all six strategies…");
    setTimeout(function () {
      try {
        var cmp = BT.compare(candles, P).sort(function (a, b) { return b.metrics.net - a.metrics.net; });
        $("bt-compare-card").hidden = false;
        var rows = cmp.map(function (c, i) {
          var m = c.metrics, btns = el("span", "cellbtns");
          var runB = el("button", "btn small", "Run"); runB.type = "button"; runB.setAttribute("aria-label", "Run " + c.mode); runB.addEventListener("click", function () { runMode(c.mode); });
          var actB = el("button", "btn small solid", "Make active"); actB.type = "button"; actB.setAttribute("aria-label", "Make " + c.mode + " active"); actB.addEventListener("click", function () { makeActive(c.mode); });
          btns.appendChild(runB); btns.appendChild(actB);
          return [(i === 0 ? "★ " : "") + c.mode, { t: money(m.net), cls: sign(m.net) }, { t: pct(m.returnPct), cls: sign(m.returnPct) }, String(m.trades), pct(m.winRate, 0), pct(m.maxDDpct), c.breakEven.text, { node: btns }];
        });
        table($("bt-compare"), [{ t: "Strategy" }, { t: "Net after costs", r: 1 }, { t: "Return", r: 1 }, { t: "Trades", r: 1 }, { t: "Win %", r: 1 }, { t: "Max drawdown", r: 1 }, { t: "Break-even slippage" }, { t: "" }], rows);
      } catch (e) { toast("Compare failed: " + e.message, true); }
      setStatus(dataInfo); busy(false);
    }, 30);
  }


  /* ================= Optimizer ================= */
  // Which settings to try for each strategy. Wide enough to learn something, small enough to finish in seconds.
  var MAX_COMBOS = 800;
  var SWEEPS = {
    "EMA VWAP": [{ key: "vwFast", label: "VWAP fast EMA", from: 5, to: 13, step: 2, int: true }, { key: "vwSlow", label: "VWAP slow EMA", from: 12, to: 30, step: 3, int: true },
                 { key: "stopMult", label: "Stop (x ATR)", from: 1.5, to: 3, step: 0.5 }, { key: "rr", label: "Reward : Risk", from: 1.5, to: 3, step: 0.5 }],
    "Breakout": [{ key: "brkLen", label: "Breakout lookback", from: 10, to: 50, step: 10, int: true }, { key: "stopMult", label: "Stop (x ATR)", from: 1.5, to: 3, step: 0.5 }, { key: "rr", label: "Reward : Risk", from: 1.5, to: 3, step: 0.5 }],
    "EMA Trend": [{ key: "fastLen", label: "Fast EMA", from: 10, to: 30, step: 5, int: true }, { key: "slowLen", label: "Slow EMA", from: 40, to: 100, step: 20, int: true },
                  { key: "stopMult", label: "Stop (x ATR)", from: 1.5, to: 3, step: 0.5 }, { key: "rr", label: "Reward : Risk", from: 1.5, to: 3, step: 0.5 }],
    "RSI Mean Reversion": [{ key: "rsiLen", label: "RSI length", from: 7, to: 21, step: 7, int: true }, { key: "rsiBuy", label: "Oversold level", from: 20, to: 35, step: 5 },
                           { key: "rsiSell", label: "Overbought level", from: 65, to: 80, step: 5 }, { key: "stopMult", label: "Stop (x ATR)", from: 1.5, to: 3, step: 0.5 }],
    "MACD Momentum": [{ key: "macdFast", label: "MACD fast", from: 8, to: 16, step: 4, int: true }, { key: "macdSlow", label: "MACD slow", from: 20, to: 34, step: 7, int: true },
                      { key: "macdSig", label: "MACD signal", from: 7, to: 11, step: 2, int: true }, { key: "stopMult", label: "Stop (x ATR)", from: 1.5, to: 3, step: 0.5 }],
    "Bollinger Bounce": [{ key: "bbLen", label: "Bollinger length", from: 14, to: 30, step: 4, int: true }, { key: "bbMult", label: "Bollinger width", from: 1.5, to: 2.5, step: 0.5 },
                         { key: "stopMult", label: "Stop (x ATR)", from: 1.5, to: 3, step: 0.5 }, { key: "rr", label: "Reward : Risk", from: 1.5, to: 3, step: 0.5 }]
  };
  var OBJECTIVES = [["calmar", "Net profit ÷ worst drawdown (recommended)"], ["net", "Net profit"], ["pf", "Profit factor"]];

  // Turns finished results into the plain-English read-out. Pure, so it is easy to test.
  function median(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  // results: [{ over, a: {train, test}, b: {train, test} }]   share = the tuning share in percent (70 = 70%)
  function summarizeOpt(results, minTrades, objKind, capital, share) {
    var valid = results.filter(function (x) { return x.a.train.trades >= minTrades && x.b.train.trades >= minTrades; });
    var out = { tried: results.length, valid: valid.length, top: [], lines: [], verdict: "" };
    if (!valid.length) { out.verdict = "No setting reached " + minTrades + " trades in both tuning periods. Lower the minimum, or load more data."; return out; }
    valid.forEach(function (x) {
      x.tObj = (BT.objectiveOf(x.a.train, objKind, capital) + BT.objectiveOf(x.b.train, objKind, capital)) / 2;
      x.bothOk = x.a.test.net > 0 && x.b.test.net > 0 && x.a.test.trades >= 5 && x.b.test.trades >= 5;
      x.worst = Math.min(x.a.test.net, x.b.test.net);
    });
    valid.sort(function (p, q) { return q.tObj - p.tObj; });
    var pctBoth = valid.filter(function (x) { return x.bothOk; }).length / valid.length * 100;
    var medWorst = median(valid.map(function (x) { return x.worst; })), medTrades = median(valid.map(function (x) { return Math.min(x.a.test.trades, x.b.test.trades); }));
    out.top = valid.slice(0, 10);
    var held = out.top.filter(function (x) { return x.bothOk; }).length;
    out.pctBoth = pctBoth; out.medianWorst = medWorst; out.held = held;
    out.lines.push("Tried " + results.length + " settings; " + valid.length + " had at least " + minTrades + " trades in both tuning periods.");
    out.lines.push("Every setting gets two out-of-sample checks. Test A: tuned on the first " + Math.round(share) + "% of the data, tested on the last " + Math.round(100 - share) + "%. Test B: tuned on the last " + Math.round(share) + "%, tested on the first " + Math.round(100 - share) + "%.");
    out.lines.push(Math.round(pctBoth) + "% of the settings were profitable in BOTH tests, and the median setting's weaker test made " + money(medWorst) + ".");
    out.lines.push(held + " of the top " + out.top.length + " by tuning score stayed profitable in both tests.");
    if (pctBoth >= 50 && medWorst > 0) out.verdict = "Good sign: most settings, not just the best ones, made money on data they were never tuned on, in both directions. The edge looks broad rather than lucky. Still confirm on a second date range before trusting it.";
    else if (pctBoth < 25 || medWorst <= 0) out.verdict = "Warning: most settings fail in at least one of the two out-of-sample tests. A great-looking top result is probably luck, so don't trade it.";
    else out.verdict = "Mixed: about half the settings hold up. Treat any result as weak evidence.";
    if (medTrades < 10) out.verdict += " The test periods had very few trades (median " + Math.round(medTrades) + "), so these numbers are noisy: load more data.";
    return out;
  }
  window.BtUI.summarizeOpt = summarizeOpt;

  var opt = { running: false, cancel: false, rows: [], els: {} };

  function optNum(v, key, step) { var i = el("input"); i.type = "number"; i.value = String(v); i.step = String(step || "any"); i.setAttribute("aria-label", key); return i; }

  function buildOptimizer() {
    var box = $("opt-box"); box.textContent = "";
    box.appendChild(el("p", "note", "Tunes the strategy chosen in step 2 on part of your data, then checks every setting on data it was never tuned on, in both directions (later data and earlier data). A setting that only works in training is overfit. Load data first."));
    var fg = el("div", "formgrid");
    function lab(text, input) { var l = el("label"); l.appendChild(document.createTextNode(text)); l.appendChild(input); fg.appendChild(l); return input; }
    var obj = el("select"); OBJECTIVES.forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; obj.appendChild(op); }); obj.value = "calmar";
    var split = el("select"); [["60", "60% tune / 40% test"], ["70", "70% tune / 30% test"], ["80", "80% tune / 20% test"]].forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; split.appendChild(op); }); split.value = "70";
    var mt = optNum(30, "Minimum trades", 1);
    opt.els.obj = lab("What to maximise", obj); opt.els.split = lab("Tune / test split", split); opt.els.min = lab("Minimum trades while tuning", mt);
    box.appendChild(fg);
    box.appendChild(el("div", "label", "Settings to try"));
    opt.els.sweep = el("div"); box.appendChild(opt.els.sweep);
    opt.els.count = el("p", "note"); box.appendChild(opt.els.count);
    var act = el("div", "actions");
    opt.els.run = el("button", "btn solid", "Run optimizer"); opt.els.run.type = "button";
    opt.els.cancel = el("button", "btn danger", "Cancel"); opt.els.cancel.type = "button"; opt.els.cancel.hidden = true;
    act.appendChild(opt.els.run); act.appendChild(opt.els.cancel); box.appendChild(act);
    opt.els.status = el("p", "note"); box.appendChild(opt.els.status);
    opt.els.out = el("div"); box.appendChild(opt.els.out);
    opt.els.run.addEventListener("click", runOptimizer);
    opt.els.cancel.addEventListener("click", function () { opt.cancel = true; });
    controls.mode.addEventListener("change", renderSweep);
    renderSweep();
  }

  function renderSweep() {
    var box = opt.els.sweep; box.textContent = ""; opt.rows = [];
    (SWEEPS[controls.mode.value] || []).forEach(function (d) {
      var row = el("div", "sweeprow");
      var cb = el("input"); cb.type = "checkbox"; cb.checked = true; cb.setAttribute("aria-label", "Try different values of " + d.label);
      var f = optNum(d.from, d.label + " from", d.step), t = optNum(d.to, d.label + " to", d.step), s = optNum(d.step, d.label + " step", "any");
      row.appendChild(cb); row.appendChild(el("span", "swl", d.label));
      [["from", f], ["to", t], ["step", s]].forEach(function (p) { var w = el("label", "swf"); w.appendChild(document.createTextNode(p[0])); w.appendChild(p[1]); row.appendChild(w); });
      [cb, f, t, s].forEach(function (x) { x.addEventListener("input", updateCount); x.addEventListener("change", updateCount); });
      box.appendChild(row); opt.rows.push({ d: d, cb: cb, f: f, t: t, s: s });
    });
    updateCount();
  }

  function readSweep() {
    var list = [];
    for (var i = 0; i < opt.rows.length; i++) {
      var r = opt.rows[i]; if (!r.cb.checked) continue;
      var from = Number(r.f.value), to = Number(r.t.value), step = Number(r.s.value);
      if (!isFinite(from) || !isFinite(to) || !(step > 0) || from > to) return { error: r.d.label + ": check from, to and step (step must be above 0, from not above to)." };
      list.push({ key: r.d.key, label: r.d.label, from: from, to: to, step: step, int: !!r.d.int });
    }
    if (!list.length) return { error: "Tick at least one setting to try." };
    return { list: list };
  }

  function updateCount() {
    var s = readSweep();
    if (s.error) { opt.els.count.textContent = s.error; return; }
    var g = BT.gridCombos(s.list, MAX_COMBOS);
    var est = candles ? " Roughly " + Math.max(1, Math.round(g.count * candles.length * 1e-5)) + " seconds with your data." : "";
    opt.els.count.textContent = g.tooMany ? g.count.toLocaleString() + " combinations is too many (the limit is " + MAX_COMBOS + "). Narrow a range or untick a setting." : g.count.toLocaleString() + " combinations to test (limit " + MAX_COMBOS + ")." + est + " More combinations means a bigger chance the winner is just luck.";
  }

  function fmtOver(o) { return Object.keys(o).map(function (k) { return k + " " + o[k]; }).join(" · "); }
  function objText(v, kind) { return kind === "net" ? money(v) : (isFinite(v) ? v.toFixed(2) : "—"); }
  function pfText(m) { return m.profitFactor === Infinity ? "∞" : (m.profitFactor === m.profitFactor ? m.profitFactor.toFixed(2) : "—"); }

  function applyOver(o) {
    Object.keys(o).forEach(function (k) { if (controls[k]) controls[k].value = String(o[k]); });
    toast("Settings applied to step 2. Press Run backtest to see them on all the data.");
  }

  function optReset() { if (opt.els.out) { opt.els.out.textContent = ""; opt.els.status.textContent = ""; } }

  function showOpt(P, sum, base, objKind, share) {
    var out = opt.els.out; out.textContent = "";
    if (!sum.top.length) { out.appendChild(el("p", "warnbox", sum.verdict)); return; }
    var box = el("div", "optsum");
    sum.lines.forEach(function (l) { box.appendChild(el("p", "", l)); });
    box.appendChild(el("p", "verdict " + (/^Good/.test(sum.verdict) ? "pos" : /^Warning/.test(sum.verdict) ? "neg" : ""), sum.verdict));
    out.appendChild(box);
    var rows = [];
    function row(label, x, over, mark) {
      var btn = el("button", "btn small", "Use"); btn.type = "button"; btn.setAttribute("aria-label", "Use these settings: " + label);
      btn.addEventListener("click", function () { applyOver(over); });
      var ok = x.a.test.net > 0 && x.b.test.net > 0 && x.a.test.trades >= 5 && x.b.test.trades >= 5;
      var score = (BT.objectiveOf(x.a.train, objKind, P.capital) + BT.objectiveOf(x.b.train, objKind, P.capital)) / 2;
      return [mark, label, objText(score, objKind), { t: money(x.a.test.net), cls: sign(x.a.test.net) }, String(x.a.test.trades), { t: money(x.b.test.net), cls: sign(x.b.test.net) }, String(x.b.test.trades),
              { t: ok ? "held up in both" : "failed", cls: ok ? "pos" : "neg" }, { node: btn }];
    }
    rows.push(row("Your current settings", base, {}, "—"));
    sum.top.forEach(function (x, i) { rows.push(row(fmtOver(x.over), x, x.over, String(i + 1))); });
    var wrap = el("div", "scroll"), tbl = el("table"); wrap.appendChild(tbl); out.appendChild(wrap);
    table(tbl, [{ t: "#" }, { t: "Settings" }, { t: "Tuning score", r: 1 }, { t: "TEST A net", r: 1 }, { t: "A trades", r: 1 }, { t: "TEST B net", r: 1 }, { t: "B trades", r: 1 }, { t: "Verdict" }, { t: "" }], rows);
    out.appendChild(el("p", "note", "Look at the TEST columns, not the tuning score. Prefer settings from the middle of a region that works over a lone spike, and don't keep re-running the optimizer and peeking: every peek makes the test periods part of the tuning."));
  }

  function runOptimizer() {
    if (opt.running) return;
    var r = readForm(); if (r.error) { toast(r.error, true); return; }
    if (!candles) { toast("Load price data first (step 1).", true); return; }
    if (candles.length < 600) { toast("You need at least 600 bars to split into tuning and test. A few thousand is better.", true); return; }
    var sw = readSweep(); if (sw.error) { toast(sw.error, true); return; }
    var g = BT.gridCombos(sw.list, MAX_COMBOS);
    if (g.tooMany) { toast(g.count + " combinations is too many. Narrow a range or untick a setting.", true); return; }
    var P = r.P, minTrades = Math.max(1, Math.round(Number(opt.els.min.value) || 30)), objKind = opt.els.obj.value, share = Number(opt.els.split.value) / 100;
    var combos = g.combos.filter(function (o) { return !validate(Object.assign({}, P, o)).error; });
    if (!combos.length) { toast("Every combination breaks a rule (for example a fast EMA at or above the slow one). Change the ranges.", true); return; }
    saveForm();
    var warm = Math.min(400, Math.floor(candles.length * share)), results = [], idx = 0, started = Date.now();
    opt.running = true; opt.cancel = false; opt.els.run.disabled = true; opt.els.cancel.hidden = false; $("bt-run").disabled = true; $("bt-compare-btn").disabled = true;
    opt.els.out.textContent = "";
    function finish(done) {
      opt.running = false; opt.els.run.disabled = false; opt.els.cancel.hidden = true; $("bt-run").disabled = false; $("bt-compare-btn").disabled = false;
      if (!done) { opt.els.status.textContent = "Cancelled after " + results.length + " of " + combos.length + " settings."; return; }
      opt.els.status.textContent = "Done in " + ((Date.now() - started) / 1000).toFixed(1) + " s.";
      var base = BT.evalFolds(candles, P, {}, share, warm);
      var sum = summarizeOpt(results, minTrades, objKind, P.capital, share * 100);
      showOpt(P, sum, base, objKind, share * 100);
    }
    (function step() {
      if (opt.cancel) { finish(false); return; }
      var end = Math.min(idx + 12, combos.length);
      for (; idx < end; idx++) { var ev = BT.evalFolds(candles, P, combos[idx], share, warm); ev.over = combos[idx]; results.push(ev); }
      opt.els.status.textContent = "Testing settings… " + idx + " / " + combos.length;
      if (idx < combos.length) setTimeout(step, 0); else finish(true);
    })();
  }

  function copySettings() {
    var r = readForm();
    if (r.error) { toast(r.error, true); return; }
    copyText(tvSettings(r.P), "Settings copied. Type them into the TradingView script.");
  }

  function resetForm() { setForm(BT.defaults()); controls.preset.value = "custom"; try { localStorage.removeItem(FORM_KEY); } catch (e) {} toast("Settings reset."); }

  function syncSource() { var csv = $("bt-src").value === "csv"; $("bt-cb").hidden = csv; $("bt-csv").hidden = !csv; }

  /* ================= Wiring ================= */
  buildForm(); restoreForm(); syncSource(); buildOptimizer();
  $("bt-src").addEventListener("change", function () { syncSource(); saveForm(); });
  $("bt-load").addEventListener("click", loadData);
  $("bt-run").addEventListener("click", run);
  $("bt-compare-btn").addEventListener("click", compareAll);
  $("bt-copy").addEventListener("click", copySettings);
  $("bt-reset").addEventListener("click", resetForm);
  $("bt-file").addEventListener("change", function () { if ($("bt-src").value === "csv") loadCsv(); });
})();

/* backtest.js — the Backtest tab on your Bots page (master only).
   Load candles (Coinbase automatically, or any market from a CSV), set the same options as the TradingView script,
   run the backtest, see where slippage kills it, compare all five strategies, and press "Make active" on the winner.
   The maths lives in bt-engine.js. Nothing here places an order, and nothing is saved on a server. */
(function () {
  "use strict";

  var IDS = ["bt-src", "bt-cb", "bt-csv", "bt-product", "bt-tf", "bt-bars", "bt-file", "bt-load", "bt-datastatus", "bt-form", "bt-run",
             "bt-compare-btn", "bt-copy", "bt-reset", "bt-results", "bt-title", "bt-hud", "bt-chart", "bt-ladder", "bt-warn",
             "bt-compare-card", "bt-compare", "bt-trades-card", "bt-trades", "toast"];
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
  var SLIPS = [0, 0.1, 0.3, 0.5, 1, 3, 4, 5];
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

  // Returns { P } or { error } from a plain object of raw values
  function validate(raw) {
    var P = Object.assign(BT.defaults(), raw);
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i], v = P[f.key];
      if (f.type === "check" || f.type === "select") continue;
      if (typeof v !== "number" || !isFinite(v) || v < f.min || v > f.max) return { error: f.label + " must be a number between " + f.min + " and " + f.max + "." };
      if (f.int && Math.floor(v) !== v) return { error: f.label + " must be a whole number." };
    }
    if (BT.MODES.indexOf(P.mode) === -1) return { error: "Pick one of the five strategies." };
    if (P.fastLen >= P.slowLen) return { error: "Fast EMA must be shorter than Slow EMA." };
    if (P.macdFast >= P.macdSlow) return { error: "MACD fast length must be shorter than the slow length." };
    if (P.rsiBuy >= P.rsiSell) return { error: "The oversold level must be below the overbought level." };
    return { P: P };
  }

  // The settings to type into the TradingView script so it matches this backtest
  function tvSettings(P) {
    var L = ["CORNY Multi-Strategy v3: set these in the script's Inputs tab", "", "Strategy: " + P.mode];
    if (P.mode === "EMA Trend") L.push("Fast EMA: " + P.fastLen, "Slow EMA: " + P.slowLen);
    if (P.mode === "RSI Mean Reversion") L.push("RSI length: " + P.rsiLen, "Oversold level (buy when RSI climbs back above): " + P.rsiBuy, "Overbought level (sell when RSI drops back below): " + P.rsiSell);
    if (P.mode === "MACD Momentum") L.push("MACD fast length: " + P.macdFast, "MACD slow length: " + P.macdSlow, "MACD signal length: " + P.macdSig);
    if (P.mode === "Bollinger Bounce") L.push("Bollinger length: " + P.bbLen, "Bollinger width (std devs): " + P.bbMult);
    if (P.mode === "Breakout") L.push("Breakout lookback (bars): " + P.brkLen);
    if (P.mode !== "EMA Trend" && P.mode !== "Breakout") L.push("Trend filter EMA (0 = off): " + P.trendLen);
    L.push("", "ATR length: " + P.atrLen, "Stop distance (x ATR): " + P.stopMult, "Reward : Risk (final target): " + P.rr,
           "Risk per trade (% of equity): " + P.riskPct, "Allow shorts: " + (P.allowShort ? "on" : "off"),
           "Slippage per market/stop order (% of price): " + P.slipPct, "");
    L.push("Move stop to break-even: " + (P.useBE ? "on (after " + P.beR + "x risk, buffer " + P.beBufATR + " ATR)" : "off"));
    L.push("Trail the stop: " + (P.useTrail ? "on (starts at " + P.trailStart + "x risk, " + P.trailATR + " ATR behind" + (P.noTarget ? ", no fixed target" : "") + ")" : "off"));
    L.push("Take partial profit: " + (P.usePartial ? "on (" + P.partialPct + "% at " + P.partialR + "x risk)" : "off"));
    L.push("", "Also in TradingView: Settings > Properties > Initial capital " + P.capital + ", Commission " + P.feePct + "%.",
           "Max leverage and whole-contracts are only in this backtester; TradingView uses its own margin settings.");
    return L.join("\n");
  }

  function warnings(P, m, be, n) {
    var w = [];
    if (m.trades < 50) w.push("Only " + m.trades + " closed trades. That is too few to trust: load more bars or use a smaller timeframe.");
    if (m.net <= 0) w.push("It loses money at " + P.slipPct + "% slippage" + (be.text ? " (break-even is " + be.text + ")" : "") + ".");
    else if (be.value !== null && be.value < 0.3) w.push("It stops making money below 0.3% slippage, which real trading easily costs. Treat it with suspicion.");
    if (m.buyHoldPct === m.buyHoldPct && m.net / P.capital * 100 < m.buyHoldPct) w.push("Just holding would have returned " + pct(m.buyHoldPct) + " over the same bars, more than this strategy.");
    w.push("Fees and slippage cost " + money(m.fees + m.slipPaid) + " in total (" + pct((m.fees + m.slipPaid) / P.capital * 100) + " of your starting money).");
    return w.join(" ");
  }

  window.BtUI = { validate: validate, tvSettings: tvSettings, warnings: warnings, FIELDS: FIELDS, money: money };

  /* ================= The settings form ================= */
  var controls = {};
  var FORM_KEY = "corny_bt_form";

  function buildForm() {
    var form = $("bt-form"); form.textContent = "";
    var main = el("div", "formgrid"); form.appendChild(main);
    var boxes = { main: main };
    [["details", "Strategy details (lengths and levels for each strategy)"], ["protect", "Profit protection (break-even, trailing stop, partial profit)"]].forEach(function (g) {
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
    var out = { data: { src: $("bt-src").value, product: $("bt-product").value, tf: $("bt-tf").value, bars: $("bt-bars").value }, form: {} };
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
      dataLoaded(r.candles, "CSV file");
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
    busy(true); setStatus(dataInfo + " · comparing five strategies…");
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

  function copySettings() {
    var r = readForm();
    if (r.error) { toast(r.error, true); return; }
    copyText(tvSettings(r.P), "Settings copied. Type them into the TradingView script.");
  }

  function resetForm() { setForm(BT.defaults()); try { localStorage.removeItem(FORM_KEY); } catch (e) {} toast("Settings reset."); }

  function syncSource() { var csv = $("bt-src").value === "csv"; $("bt-cb").hidden = csv; $("bt-csv").hidden = !csv; }

  /* ================= Wiring ================= */
  buildForm(); restoreForm(); syncSource();
  $("bt-src").addEventListener("change", function () { syncSource(); saveForm(); });
  $("bt-load").addEventListener("click", loadData);
  $("bt-run").addEventListener("click", run);
  $("bt-compare-btn").addEventListener("click", compareAll);
  $("bt-copy").addEventListener("click", copySettings);
  $("bt-reset").addEventListener("click", resetForm);
  $("bt-file").addEventListener("change", function () { if ($("bt-src").value === "csv") loadCsv(); });
})();

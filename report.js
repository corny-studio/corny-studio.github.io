/* report.js — the Trade report tab on your Bots page (master only).
   Drop in the CSV from TradingView's Strategy Tester ("List of trades" > download icon) and get a breakdown by side, year and exit type,
   how much of the profit came from a few trades, how big a typical stop-out really is, and plain-English findings.
   It is read in your browser. Nothing is uploaded and nothing is stored. */
(function () {
  "use strict";

  /* ================= Pure analysis (also used by tests) ================= */
  function splitCsvLine(line) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (q) { if (ch === '"') { if (line.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function num(v) { var n = parseFloat(String(v === undefined ? "" : v).replace(/[^0-9eE+\-.]/g, "")); return isFinite(n) ? n : NaN; }
  function when(s) { var t = Date.parse(String(s).trim().replace(" ", "T") + (/[zZ]|[+\-]\d\d:?\d\d$/.test(String(s).trim()) ? "" : "Z")); return isFinite(t) ? t : NaN; }

  // Returns { trades } or { error }
  function parse(text) {
    var lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });
    if (lines.length < 3) return { error: "That file has no trades in it." };
    var head = splitCsvLine(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
    function col(re, not) { for (var i = 0; i < head.length; i++) if (re.test(head[i]) && !(not && not.test(head[i]))) return i; return -1; }
    var c = { n: col(/^trade number/), type: col(/^type/), t: col(/^date/), sig: col(/^signal/), price: col(/^price/), qty: col(/^size \(qty\)/),
              pnl: col(/^net p(&|n)l|^net pnl/, /%/), comm: col(/^commission/), mfe: col(/^favorable excursion/, /%/), mae: col(/^adverse excursion/, /%/), bars: col(/^duration/) };
    var missing = ["n", "type", "t", "price", "pnl"].filter(function (k) { return c[k] < 0; });
    if (missing.length) return { error: "This doesn't look like TradingView's trade list. In the Strategy Tester open List of trades and use the download icon. Missing columns: " + missing.join(", ") + "." };
    var byTrade = {};
    for (var i = 1; i < lines.length; i++) {
      var f = splitCsvLine(lines[i]), id = f[c.n], type = (f[c.type] || "").toLowerCase();
      var kind = type.indexOf("entry") === 0 ? "entry" : type.indexOf("exit") === 0 ? "exit" : null;
      if (!kind || !id) continue;
      (byTrade[id] = byTrade[id] || {})[kind] = f;
    }
    var trades = [];
    Object.keys(byTrade).forEach(function (id) {
      var e = byTrade[id].entry, x = byTrade[id].exit;
      if (!e || !x) return;                                   // an open trade has no exit yet
      var side = /short/i.test(e[c.type]) ? "short" : "long";
      var t = { n: Number(id), side: side, entryT: when(e[c.t]), exitT: when(x[c.t]), entry: num(e[c.price]), exit: num(x[c.price]),
                reason: c.sig >= 0 ? String(x[c.sig] || "").trim() : "", qty: c.qty >= 0 ? num(e[c.qty]) : 1,
                pnl: num(e[c.pnl]), comm: c.comm >= 0 ? num(e[c.comm]) : 0, mfe: c.mfe >= 0 ? num(e[c.mfe]) : NaN, mae: c.mae >= 0 ? num(e[c.mae]) : NaN,
                bars: c.bars >= 0 ? num(e[c.bars]) : NaN };
      if (isFinite(t.pnl) && isFinite(t.exitT)) trades.push(t);
    });
    trades.sort(function (a, b) { return a.exitT - b.exitT || a.n - b.n; });
    if (trades.length < 3) return { error: "I found fewer than 3 closed trades in that file." };
    return { trades: trades };
  }

  function stats(tr) {
    var n = tr.length, out = { n: n };
    if (!n) return { n: 0, net: 0, wins: 0, winRate: NaN, pf: NaN, avg: NaN, avgWin: NaN, avgLoss: NaN, payoff: NaN, se: NaN, t: NaN, maxDD: 0, worst: 0, streak: 0 };
    var gp = 0, gl = 0, w = 0, sum = 0;
    tr.forEach(function (x) { sum += x.pnl; if (x.pnl > 0) { gp += x.pnl; w++; } else gl -= x.pnl; });
    var mean = sum / n, v = 0;
    tr.forEach(function (x) { v += (x.pnl - mean) * (x.pnl - mean); });
    var sd = n > 1 ? Math.sqrt(v / (n - 1)) : NaN, se = sd / Math.sqrt(n);
    var eq = 0, peak = 0, dd = 0, run = 0, streak = 0, worst = 0;
    tr.slice().sort(function (a, b) { return a.exitT - b.exitT; }).forEach(function (x) {
      eq += x.pnl; if (eq > peak) peak = eq; if (peak - eq > dd) dd = peak - eq;
      run = x.pnl > 0 ? 0 : run + 1; if (run > streak) streak = run;
      if (x.pnl < worst) worst = x.pnl;
    });
    out.net = sum; out.wins = w; out.winRate = w / n * 100; out.pf = gl > 0 ? gp / gl : (gp > 0 ? Infinity : NaN);
    out.avg = mean; out.avgWin = w ? gp / w : NaN; out.avgLoss = n - w ? -gl / (n - w) : NaN; out.payoff = out.avgWin / -out.avgLoss;
    out.se = se; out.t = mean / se; out.maxDD = dd; out.worst = worst; out.streak = streak;
    return out;
  }

  function rng(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function pct(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))]; }

  function bootstrap(tr, B) {
    if (tr.length < 10) return null;
    var r = rng(12345), v = tr.map(function (x) { return x.pnl; }), pfs = [], nets = [];
    for (var b = 0; b < (B || 2000); b++) {
      var gp = 0, gl = 0, sum = 0;
      for (var i = 0; i < v.length; i++) { var p = v[Math.floor(r() * v.length)]; sum += p; if (p > 0) gp += p; else gl -= p; }
      pfs.push(gl > 0 ? gp / gl : 99); nets.push(sum);
    }
    pfs.sort(function (a, c) { return a - c; }); nets.sort(function (a, c) { return a - c; });
    return { pf: [pct(pfs, 0.025), pct(pfs, 0.975)], net: [pct(nets, 0.025), pct(nets, 0.975)], below1: pfs.filter(function (x) { return x < 1; }).length / pfs.length * 100 };
  }

  function median(a) { if (!a.length) return NaN; var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  function analyze(trades) {
    var L = trades.filter(function (x) { return x.side === "long"; }), S = trades.filter(function (x) { return x.side === "short"; });
    var years = {};
    trades.forEach(function (x) { var y = new Date(x.exitT).getUTCFullYear(); (years[y] = years[y] || []).push(x); });
    var byYear = Object.keys(years).sort().map(function (y) {
      var a = years[y];
      return { year: Number(y), all: stats(a), long: stats(a.filter(function (x) { return x.side === "long"; })), short: stats(a.filter(function (x) { return x.side === "short"; })) };
    });
    var rs = {};
    trades.forEach(function (x) { var k = x.side + "|" + (x.reason || "(none)"); (rs[k] = rs[k] || []).push(x); });
    var byReason = Object.keys(rs).sort().map(function (k) { var a = rs[k], st = stats(a); return { side: k.split("|")[0], reason: k.split("|")[1], n: a.length, net: st.net, winRate: st.winRate, avg: st.avg, bars: median(a.map(function (x) { return x.bars; }).filter(isFinite)) }; });
    var sorted = trades.map(function (x) { return x.pnl; }).sort(function (a, b) { return b - a; });
    var top = function (k) { return sorted.slice(0, k).reduce(function (s, v) { return s + v; }, 0); };
    var all = stats(trades);
    // typical cost of a stop-out per contract, by year (the loss at the stop is about one "R")
    var risk = Object.keys(years).sort().map(function (y) {
      var m = years[y].filter(function (x) { return /exit$/i.test(x.reason) && x.pnl < 0 && isFinite(x.mae); }).map(function (x) { return -x.mae; });
      return { year: Number(y), n: m.length, r: m.length >= 3 ? median(m) : NaN };
    });
    return { all: all, long: stats(L), short: stats(S), byYear: byYear, byReason: byReason, top5: top(5), top10: top(10), risk: risk, boot: bootstrap(trades), bootLong: bootstrap(L),
             first: trades[0].entryT, last: trades[trades.length - 1].exitT };
  }

  function money(x) { var n = Math.round(Number(x) || 0); return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US"); }
  function f1(x) { return isFinite(x) ? x.toFixed(1) : "—"; }
  function f2(x) { return x === Infinity ? "∞" : isFinite(x) ? x.toFixed(2) : "—"; }

  // Plain-English findings. Each one says what the data shows; none of them is a promise.
  function findings(a, capital) {
    var out = [], all = a.all;
    out.push((all.pf < 1.1 || all.t < 1 ? "No clear edge overall: " : "") + "average trade " + money(all.avg) + ", give or take " + money(all.se) + " (profit factor " + f2(all.pf) + ", " + all.n + " trades).");
    if (a.long.n >= 20 && a.short.n >= 20) {
      var lose = a.long.net < 0 && a.short.net > 0 ? "long" : a.short.net < 0 && a.long.net > 0 ? "short" : null;
      if (lose) {
        var bad = a[lose], good = a[lose === "long" ? "short" : "long"];
        out.push("The " + lose + " side loses (" + bad.n + " trades, " + money(bad.net) + ", profit factor " + f2(bad.pf) + ") while the " + (lose === "long" ? "short" : "long") + " side makes " + money(good.net) +
                 ". Without the " + lose + " trades the total would have been " + money(good.net) + " instead of " + money(all.net) + ". That is hindsight on one data set, so test it before relying on it.");
      } else {
        out.push("Long: " + a.long.n + " trades, " + money(a.long.net) + " (PF " + f2(a.long.pf) + "). Short: " + a.short.n + " trades, " + money(a.short.net) + " (PF " + f2(a.short.pf) + ").");
      }
    }
    var pos = a.byYear.filter(function (y) { return y.all.net > 0; }).length;
    out.push("Profitable in " + pos + " of " + a.byYear.length + " calendar years" + (pos === a.byYear.length ? "." : ": " + a.byYear.filter(function (y) { return y.all.net <= 0; }).map(function (y) { return y.year; }).join(", ") + " lost."));
    if (all.net > 0) {
      var best = a.byYear.slice().sort(function (x, y) { return y.all.net - x.all.net; })[0];
      if (best.all.net / all.net > 0.6 && a.byYear.length > 2) out.push(best.year + " alone made " + Math.round(best.all.net / all.net * 100) + "% of the total profit.");
      out.push("The ten best trades made " + money(a.top10) + (all.net > 0 ? " (" + Math.round(a.top10 / all.net * 100) + "% of the total)" : "") + "; without them the result would be " + money(all.net - a.top10) + ".");
    } else out.push("The ten best trades made " + money(a.top10) + "; the other " + (all.n - 10) + " lost " + money(all.net - a.top10) + " between them.");
    var rk = a.risk.filter(function (r) { return isFinite(r.r); });
    if (rk.length >= 2) {
      var f = rk[0], l = rk[rk.length - 1];
      out.push("A typical stop-out cost about " + money(f.r) + " per contract in " + f.year + " and about " + money(l.r) + " in " + l.year + (capital > 0 ? " (" + (l.r / capital * 100).toFixed(1) + "% of a " + money(capital) + " account)" : "") + ". Size your account for the recent number, not the old one.");
    }
    out.push("Longest losing streak: " + all.streak + " trades. Worst single loss: " + money(all.worst) + ". Deepest closed-trade drawdown: " + money(all.maxDD) + (capital > 0 ? " (" + Math.round(all.maxDD / capital * 100) + "% of " + money(capital) + ")" : "") + ".");
    if (a.boot) out.push("Resampling these trades gives a 95% range for profit factor of " + f2(a.boot.pf[0]) + " to " + f2(a.boot.pf[1]) + ". That assumes the future resembles the past and ignores that this setup was chosen after looking at the data.");
    out.push("This is one market in one period. Treat it as evidence about the past, not a forecast.");
    return out;
  }

  window.TradeReport = { parse: parse, stats: stats, analyze: analyze, findings: findings, money: money };

  /* ================= The tab ================= */
  var IDS = ["rp-file", "rp-capital", "rp-status", "rp-out"];
  if (typeof document === "undefined" || IDS.some(function (id) { return !document.getElementById(id); })) return;   // an older bots.html is explained by bots.js
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function sign(x) { return x > 0 ? "pos" : x < 0 ? "neg" : "zero"; }

  function table(headers, rows) {
    var wrap = el("div", "scroll"), t = el("table"), th = el("thead"), hr = el("tr");
    headers.forEach(function (h) { hr.appendChild(el("th", h.r ? "r" : "", h.t)); }); th.appendChild(hr); t.appendChild(th);
    var tb = el("tbody");
    rows.forEach(function (cells) {
      var tr = el("tr");
      cells.forEach(function (c, i) { var td = el("td", headers[i].r ? "r" : ""); td.textContent = c && typeof c === "object" ? c.t : c; if (c && c.cls) td.className += " " + c.cls; tr.appendChild(td); });
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); return wrap;
  }
  function chip(box, k, v, cls) { var c = el("div", "chip"); c.appendChild(el("span", "k", k)); c.appendChild(el("span", "v " + (cls || ""), v)); box.appendChild(c); }
  function sideRow(label, s) { return [label, String(s.n), { t: money(s.net), cls: sign(s.net) }, isFinite(s.winRate) ? f1(s.winRate) + "%" : "—", f2(s.pf), isFinite(s.avg) ? money(s.avg) : "—", s.n ? money(s.worst) : "—"]; }

  function render(trades) {
    var capital = Number($("rp-capital").value); if (!(capital > 0)) capital = 0;
    var a = analyze(trades), out = $("rp-out"); out.textContent = "";
    var card = el("section", "card"); card.appendChild(el("h2", "", "Summary"));
    var hud = el("div", "rowchips");
    chip(hud, "Trades", String(a.all.n), "zero"); chip(hud, "Net", money(a.all.net), sign(a.all.net)); chip(hud, "Win rate", f1(a.all.winRate) + "%", "zero");
    chip(hud, "Profit factor", f2(a.all.pf), a.all.pf >= 1.3 ? "pos" : a.all.pf < 1.1 ? "neg" : "zero"); chip(hud, "Average trade", money(a.all.avg) + " ± " + money(a.all.se), sign(a.all.avg));
    chip(hud, "Closed-trade drawdown", money(a.all.maxDD), "neg"); chip(hud, "Worst loss", money(a.all.worst), "neg");
    card.appendChild(hud);
    var box = el("div", "optsum"); box.appendChild(el("p", "", "What this data shows"));
    findings(a, capital).forEach(function (t) { box.appendChild(el("p", "", "• " + t)); });
    card.appendChild(box); out.appendChild(card);

    var c2 = el("section", "card"); c2.appendChild(el("h2", "", "Long versus short"));
    c2.appendChild(table([{ t: "" }, { t: "Trades", r: 1 }, { t: "Net", r: 1 }, { t: "Win rate", r: 1 }, { t: "Profit factor", r: 1 }, { t: "Average", r: 1 }, { t: "Worst loss", r: 1 }],
      [sideRow("Long", a.long), sideRow("Short", a.short), sideRow("Both", a.all)]));
    out.appendChild(c2);

    var c3 = el("section", "card"); c3.appendChild(el("h2", "", "By year (exit date)"));
    c3.appendChild(table([{ t: "Year" }, { t: "Trades", r: 1 }, { t: "Net", r: 1 }, { t: "Win rate", r: 1 }, { t: "PF", r: 1 }, { t: "Long net", r: 1 }, { t: "Short net", r: 1 }, { t: "Typical stop-out", r: 1 }],
      a.byYear.map(function (y, i) { var r = a.risk.filter(function (z) { return z.year === y.year; })[0];
        return [String(y.year), String(y.all.n), { t: money(y.all.net), cls: sign(y.all.net) }, f1(y.all.winRate) + "%", f2(y.all.pf), { t: y.long.n ? money(y.long.net) : "—", cls: sign(y.long.net) }, { t: y.short.n ? money(y.short.net) : "—", cls: sign(y.short.net) }, r && isFinite(r.r) ? money(r.r) : "—"]; })));
    out.appendChild(c3);

    var c4 = el("section", "card"); c4.appendChild(el("h2", "", "By exit type"));
    c4.appendChild(table([{ t: "Side" }, { t: "How it ended" }, { t: "Trades", r: 1 }, { t: "Net", r: 1 }, { t: "Win rate", r: 1 }, { t: "Average", r: 1 }, { t: "Typical bars held", r: 1 }],
      a.byReason.map(function (r) { return [r.side, r.reason, String(r.n), { t: money(r.net), cls: sign(r.net) }, f1(r.winRate) + "%", money(r.avg), isFinite(r.bars) ? String(Math.round(r.bars)) : "—"]; })));
    c4.appendChild(el("p", "note", "A \"... exit\" is a stop or a target being hit. \"Long\" or \"Short\" in this column means a signal in the other direction closed the trade early."));
    out.appendChild(c4);
  }

  function load() {
    var f = $("rp-file").files && $("rp-file").files[0];
    if (!f) { $("rp-status").textContent = "Choose the trade list CSV first."; return Promise.resolve(); }
    return f.text().then(function (text) {
      var r = parse(text);
      if (r.error) { $("rp-status").textContent = r.error; $("rp-out").textContent = ""; return; }
      var d = function (t) { return new Date(t).toISOString().slice(0, 10); };
      $("rp-status").textContent = r.trades.length + " closed trades, " + d(r.trades[0].entryT) + " to " + d(r.trades[r.trades.length - 1].exitT) + ". Read in your browser, nothing uploaded.";
      render(r.trades);
    }, function (e) { $("rp-status").textContent = "Couldn't read that file: " + e.message; });
  }

  $("rp-file").addEventListener("change", load);
  $("rp-capital").addEventListener("change", function () { if ($("rp-file").files && $("rp-file").files[0]) load(); });
})();

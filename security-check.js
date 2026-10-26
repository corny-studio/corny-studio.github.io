/* security-check.js
   A live check of this site's security, run in the visitor's browser. It does two things:

   1. Server settings: it asks the server for this page's response headers (and the background
      page's policy) and tests each one.
   2. Code checks: it reads this site's own HTML and JavaScript files and looks for risky patterns,
      such as inline scripts, third-party scripts with no integrity hash, eval, and innerHTML writes.

   It shows "Secure" only when every check passes, and "Not secure" otherwise. If it cannot run, it
   says so and never shows a pass.

   Limits, stated plainly: it runs inside the page, so a tampered page could lie, and a pattern scan
   is not a full code review. It shows configuration and code hygiene, not that the site cannot be
   attacked. For an independent result, use the scanner links under the result. */
(function () {
  "use strict";

  var MIN_HSTS = 15552000; // 180 days, in seconds

  /* ---------- Content Security Policy helpers ---------- */

  // The values listed for one directive of a policy, or null if it is missing.
  function directive(csp, name) {
    var parts = String(csp || "").split(";");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      var low = p.toLowerCase();
      if (low === name || low.indexOf(name + " ") === 0) {
        return low.slice(name.length).trim().split(/\s+/).filter(Boolean);
      }
    }
    return null;
  }

  // What makes a policy weak for scripts. An empty list means strict enough.
  function cspProblems(csp) {
    if (!csp) return ["header missing"];
    var bad = [];
    var scripts = directive(csp, "script-src") || directive(csp, "default-src");
    if (!scripts) bad.push("no script-src or default-src");
    else {
      if (scripts.indexOf("'unsafe-inline'") > -1) bad.push("allows inline scripts");
      if (scripts.indexOf("'unsafe-eval'") > -1) bad.push("allows eval");
      if (scripts.indexOf("*") > -1) bad.push("allows scripts from anywhere");
    }
    return bad;
  }

  /* ---------- 1. Server settings ---------- */

  // get(name) returns a header value or null.
  // ctx = { https: boolean, metaCsp: boolean, bgCsp: undefined (no background page) | null (could not read) | string }
  function evaluate(get, ctx) {
    var out = [];
    function add(label, pass, detail) { out.push({ group: "server", label: label, pass: !!pass, detail: detail || "" }); }

    add("Connection is encrypted (HTTPS)", ctx.https, ctx.https ? "" : "this page was not loaded over HTTPS");

    var hsts = get("strict-transport-security") || "";
    var m = /max-age=(\d+)/i.exec(hsts);
    var hstsOk = !!(m && Number(m[1]) >= MIN_HSTS);
    add("Browsers are told to always use HTTPS (HSTS)", hstsOk, !hsts ? "header missing" : (hstsOk ? "" : "lifetime is under 180 days"));

    var csp = get("content-security-policy") || "";
    var bad = cspProblems(csp);
    if (!csp && ctx.metaCsp) bad = ["only a meta-tag policy was found, which is weaker and cannot protect against embedding"];
    add("A strict Content Security Policy is sent by the server", bad.length === 0, bad.join("; "));

    if (ctx.bgCsp !== undefined) {
      var bgBad = ctx.bgCsp === null ? ["could not read the background page"] : cspProblems(ctx.bgCsp);
      add("The background page's Content Security Policy is strict too", bgBad.length === 0, bgBad.join("; "));
    }

    var nosniff = /nosniff/i.test(get("x-content-type-options") || "");
    add("Browsers cannot guess file types (nosniff)", nosniff, nosniff ? "" : "header missing");

    var fa = directive(csp, "frame-ancestors");
    var xfo = /^(deny|sameorigin)$/i.test((get("x-frame-options") || "").trim());
    var framed = !!((fa && fa.indexOf("*") === -1) || xfo);
    add("Other sites cannot embed this page (clickjacking protection)", framed, framed ? "" : "no frame-ancestors or X-Frame-Options");

    var ref = get("referrer-policy") || "";
    add("Outgoing links do not reveal this page's address (Referrer-Policy)", ref && !/unsafe-url/i.test(ref), ref ? (/unsafe-url/i.test(ref) ? "set to unsafe-url" : "") : "header missing");

    var perm = get("permissions-policy");
    add("Unneeded browser features are switched off (Permissions-Policy)", !!perm, perm ? "" : "header missing");

    return out;
  }

  /* ---------- 2. Code checks ---------- */

  var CODE_RULES = [
    ["inline-script", "No inline scripts"],
    ["inline-handler", "No inline event handlers such as onclick"],
    ["third-party-integrity", "Every third-party script and stylesheet carries an integrity hash"],
    ["runtime-injection", "No script is injected into the page at runtime"],
    ["eval", "No eval, new Function or document.write"],
    ["innerhtml", "No innerHTML, outerHTML or insertAdjacentHTML writes"],
    ["js-url", "No javascript: links"],
    ["noopener", "Links that open a new tab use noopener"],
    ["http-resource", "No plain-HTTP links or resources"],
    ["readable", "Every site file could be read and scanned"]
  ];

  function stripComments(js) {
    return String(js).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"\\])\/\/.*$/gm, "$1");
  }

  function safeUrl(v, base) { try { return new URL(v, base); } catch (e) { return null; } }

  // Attributes of one tag, from the text between the tag name and the closing bracket.
  function parseAttrs(str) {
    var attrs = {}, m;
    var re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    while ((m = re.exec(str))) {
      attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ""));
    }
    return attrs;
  }

  // Looks for risky patterns in JavaScript text. add(rule, message) records a finding.
  function scanJs(js, label, add) {
    var code = stripComments(js);
    [
      ["eval", /\beval\s*\(/, "calls eval"],
      ["eval", /\bnew\s+Function\s*\(/, "uses new Function"],
      ["eval", /\bdocument\.write(ln)?\s*\(/, "uses document.write"],
      ["innerhtml", /\.(innerHTML|outerHTML)\s*\+?=(?!=)/, "assigns innerHTML or outerHTML"],
      ["innerhtml", /\.insertAdjacentHTML\s*\(/, "uses insertAdjacentHTML"],
      ["runtime-injection", /createElement\(\s*(["'`])script\1\s*\)/, "creates a script element at runtime"]
    ].forEach(function (r) { if (r[1].test(code)) add(r[0], label + ": " + r[2]); });
  }

  // Looks for risky patterns in an HTML page. This reads the page as text, which is enough for the
  // simple pages on this site; it is not a full HTML parser. Returns the same-site scripts and frames
  // it found, so the caller can scan those too.
  function scanHtml(html, label, base, origin, add) {
    var out = { scripts: [], frames: [] };
    var text = String(html).replace(/<!--[\s\S]*?-->/g, "");
    var scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, m;

    while ((m = scriptRe.exec(text))) {
      var a = parseAttrs(m[1]), body = m[2];
      if (a.src === undefined) {
        var isJs = !a.type || /javascript|module/i.test(a.type);
        if (isJs && body.trim()) {
          add("inline-script", label + ": inline script (" + body.length + " characters)");
          scanJs(body, label + " inline script", add);
        }
      } else {
        var u = safeUrl(a.src, base);
        if (!u) continue;
        if (u.protocol === "http:") add("http-resource", label + ": script loaded over plain HTTP");
        if (u.origin !== origin) {
          if (!a.integrity || a.crossorigin === undefined) add("third-party-integrity", label + ": script from " + u.hostname + " has no integrity hash");
        } else out.scripts.push(u.href);
      }
    }

    text = text.replace(scriptRe, "<script></script>").replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "<style></style>");
    var tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
    while ((m = tagRe.exec(text))) {
      var tag = m[1].toLowerCase(), t = parseAttrs(m[2]);
      Object.keys(t).forEach(function (k) { if (/^on[a-z]+$/.test(k)) add("inline-handler", label + ": <" + tag + "> has " + k); });
      ["href", "src", "action", "formaction"].forEach(function (k) {
        var v = t[k];
        if (v === undefined) return;
        if (/^\s*javascript:/i.test(v)) add("js-url", label + ": <" + tag + "> " + k + " starts with javascript:");
        var uu = safeUrl(v, base);
        if (uu && uu.protocol === "http:") add("http-resource", label + ": <" + tag + "> " + k + " uses plain HTTP");
      });
      if (tag === "a" && /^_blank$/i.test(t.target || "") && !/noopener/i.test(t.rel || "")) add("noopener", label + ": a link opens a new tab without noopener");
      if (tag === "link" && /stylesheet/i.test(t.rel || "") && t.href) {
        var lu = safeUrl(t.href, base);
        if (lu && lu.origin !== origin && (!t.integrity || t.crossorigin === undefined)) add("third-party-integrity", label + ": stylesheet from " + lu.hostname + " has no integrity hash");
      }
      if (tag === "iframe" && t.src) {
        var fu = safeUrl(t.src, base);
        if (fu && fu.origin === origin) out.frames.push(fu.href);
      }
    }
    return out;
  }

  function brief(list) {
    var shown = list.slice(0, 2).join("; ");
    return list.length > 2 ? shown + "; and " + (list.length - 2) + " more" : shown;
  }

  // Reads the start page, the pages it frames, and every same-site script, and scans them.
  // getText(url) returns a promise for the file's text. Resolves to { checks, files }.
  function scanSite(getText, startUrl, origin) {
    var findings = {}, files = [], errors = [], scripts = [], frames = [];
    function add(rule, msg) { (findings[rule] = findings[rule] || []).push(msg); }
    function nameOf(u) { var p = new URL(u).pathname.split("/").pop(); return p || "index.html"; }
    function pushUnique(list, items) { items.forEach(function (x) { if (list.indexOf(x) === -1) list.push(x); }); }

    function readPage(url) {
      return getText(url).then(function (html) {
        files.push(nameOf(url));
        var r = scanHtml(html, nameOf(url), url, origin, add);
        pushUnique(scripts, r.scripts); pushUnique(frames, r.frames);
      }, function () { errors.push(nameOf(url)); });
    }

    return readPage(startUrl)
      .then(function () { return Promise.all(frames.slice(0, 3).map(readPage)); })
      .then(function () {
        return Promise.all(scripts.slice(0, 12).map(function (u) {
          return getText(u).then(function (js) { files.push(nameOf(u)); scanJs(js, nameOf(u), add); }, function () { errors.push(nameOf(u)); });
        }));
      })
      .then(function () {
        var checks = CODE_RULES.map(function (r) {
          if (r[0] === "readable") return { group: "code", label: r[1], pass: errors.length === 0, detail: errors.length ? "could not read " + errors.join(", ") : "" };
          var f = findings[r[0]];
          return { group: "code", label: r[1], pass: !f, detail: f ? brief(f) : "" };
        });
        return { checks: checks, files: files };
      });
  }

  function summarize(results) {
    var failed = results.filter(function (r) { return !r.pass; }).length;
    return failed === 0
      ? { state: "secure", text: "Secure. All " + results.length + " checks passed." }
      : { state: "insecure", text: "Not secure. " + failed + " of " + results.length + " checks failed." };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { evaluate: evaluate, summarize: summarize, directive: directive, cspProblems: cspProblems, scanHtml: scanHtml, scanJs: scanJs, scanSite: scanSite };
  }
  if (typeof document === "undefined") return;

  /* ---------- The page ---------- */

  function $(id) { return document.getElementById(id); }
  function el(tag, text) { var n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; }

  function setState(state, text) {
    var s = $("sec-status");
    if (!s) return;
    s.setAttribute("data-state", state);
    s.textContent = text;
  }

  function addVerifierLinks() {
    var box = $("sec-verify");
    if (!box || location.protocol !== "https:") return;
    var host = location.hostname, home = location.origin + "/";
    [
      ["Security Headers", "https://securityheaders.com/?q=" + encodeURIComponent(home) + "&followRedirects=on"],
      ["Mozilla Observatory", "https://developer.mozilla.org/en-US/observatory/analyze?host=" + encodeURIComponent(host)],
      ["SSL Labs", "https://www.ssllabs.com/ssltest/analyze.html?d=" + encodeURIComponent(host)]
    ].forEach(function (l) {
      var li = el("li"), a = el("a", l[0]);
      a.href = l[1]; a.rel = "noopener noreferrer"; a.target = "_blank";
      li.appendChild(a); box.appendChild(li);
    });
  }

  function getText(u) {
    return fetch(u, { cache: "no-store", credentials: "omit" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  function run() {
    if (!$("sec-status")) return;
    addVerifierLinks();
    if (location.protocol === "file:") { setState("error", "Cannot check from a local file. Open the site at its web address. This is not a pass."); return; }
    setState("checking", "Checking this site's security settings and code…");

    var pageUrl = location.origin + location.pathname;
    var frame = $("space-hull"), frameUrl = frame && frame.getAttribute("src") ? new URL(frame.getAttribute("src"), location.href).href : null;
    var opts = { method: "HEAD", cache: "no-store", credentials: "omit" };

    Promise.all([
      fetch(pageUrl + location.search, opts),
      frameUrl ? fetch(frameUrl, opts).then(function (r) { return r.headers.get("content-security-policy") || ""; }, function () { return null; }) : Promise.resolve(undefined),
      scanSite(getText, pageUrl, location.origin)
    ]).then(function (a) {
      var res = a[0];
      var server = evaluate(function (n) { return res.headers.get(n); }, {
        https: location.protocol === "https:" && window.isSecureContext === true,
        metaCsp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
        bgCsp: a[1]
      });
      var results = server.concat(a[2].checks), sum = summarize(results);
      setState(sum.state, sum.text);
      [["sec-list", "server"], ["sec-code", "code"]].forEach(function (g) {
        var list = $(g[0]);
        if (!list) return;
        list.textContent = "";
        results.filter(function (c) { return c.group === g[1]; }).forEach(function (c) {
          list.appendChild(el("li", (c.pass ? "Pass: " : "Fail: ") + c.label + (c.detail ? " (" + c.detail + ")" : "")));
        });
      });
      var meta = $("sec-meta");
      if (meta) meta.textContent = "Checked at " + new Date().toLocaleTimeString() + ". Files scanned: " + a[2].files.join(", ") + ". This is a pattern scan, not a full code review.";
    }).catch(function () { setState("error", "Could not run the check. This is not a pass."); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();

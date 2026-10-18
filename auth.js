/* auth.js — shared master login for every page.
   With a relay configured, the master key is checked on the server (the key never has to live in this file).
   Without one, it falls back to ADMIN_CORE_SECRET below, which is visible to anyone: treat it as cosmetic. */
(function () {
  "use strict";

  /* ===== Only used when no relay is set (or the relay is unreachable). Keep the quotes. ===== */
  var ADMIN_CORE_SECRET = "CHANGE_ME";
  /* ========================================================================================= */

  var cfg = window.CORNY_CONFIG || {};
  var relay = (cfg.relayUrl || "").replace(/\/$/, "");

  function read(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} }

  function role() { var r = read("corny_role"); return r === "admin" || r === "guest" ? r : null; }
  function isAdmin() { return role() === "admin"; }
  function key() { return isAdmin() ? (read("corny_key") || "") : ""; }

  function localMatch(v) { return ADMIN_CORE_SECRET !== "CHANGE_ME" && v === ADMIN_CORE_SECRET; }

  /* Returns "admin", "guest" or null. */
  async function login(value, opts) {
    var v = (value || "").trim();
    if (!v) return null;
    if (v.toLowerCase() === "guest") {
      if (opts && opts.masterOnly) return null;
      write("corny_role", "guest"); write("corny_key", null);
      return "guest";
    }
    var ok = false;
    if (relay) {
      try {
        var r = await fetch(relay + "/auth", { method: "POST", headers: { "X-Admin-Key": v } });
        ok = r.ok;
        if (!ok && r.status !== 403) throw new Error("relay " + r.status);
      } catch (e) { ok = localMatch(v); }
    } else { ok = localMatch(v); }
    if (!ok) return null;
    write("corny_role", "admin"); write("corny_key", v);
    return "admin";
  }

  function logout() { write("corny_role", null); write("corny_key", null); fire(); render(); }
  function fire() { try { window.dispatchEvent(new CustomEvent("corny-auth")); } catch (e) {} }

  /* ---------- Header control + modal (pages with <span id="auth-slot">) ---------- */
  function h(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }

  function injectStyles() {
    if (document.getElementById("auth-styles")) return;
    var s = document.createElement("style"); s.id = "auth-styles";
    s.textContent =
      ".auth-wrap{display:inline-flex;align-items:center;gap:.5rem}" +
      ".auth-btn{background:transparent;border:1px solid #21262d;color:#8b949e;border-radius:6px;padding:.4rem .7rem;font:.78rem monospace;cursor:pointer}" +
      ".auth-btn:hover{border-color:#00f0ff;color:#00f0ff}" +
      ".auth-chip{font:bold .7rem monospace;letter-spacing:1px;color:#39ff14;border:1px solid #39ff14;border-radius:4px;padding:.2rem .5rem}" +
      ".auth-link{font:.78rem monospace;color:#00f0ff;text-decoration:none}" +
      "#auth-overlay{position:fixed;inset:0;z-index:5000;background:rgba(3,6,10,.8);display:flex;align-items:center;justify-content:center;padding:1rem}" +
      ".auth-modal{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:1.5rem;width:100%;max-width:340px;font-family:monospace;color:#c9d1d9}" +
      ".auth-modal h2{margin:0 0 1rem;font-size:1rem;color:#00f0ff}" +
      ".auth-modal input{width:100%;box-sizing:border-box;background:#06090e;border:1px solid #30363d;color:#fff;border-radius:4px;padding:.65rem;font:.9rem monospace;outline:none}" +
      ".auth-modal input:focus{border-color:#00f0ff}" +
      ".auth-err{color:#ff5c7a;font-size:.75rem;min-height:1.2em;margin:.5rem 0}" +
      ".auth-row{display:flex;gap:.5rem}" +
      ".auth-row .auth-btn.primary{background:#00f0ff;color:#000;border-color:#00f0ff;font-weight:bold}";
    document.head.appendChild(s);
  }

  function openModal() {
    if (document.getElementById("auth-overlay")) return;
    var ov = h("div"); ov.id = "auth-overlay";
    var box = h("div", "auth-modal");
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Master login");
    box.appendChild(h("h2", "", "Master login"));
    var inp = document.createElement("input"); inp.type = "password"; inp.placeholder = "master key"; inp.autocomplete = "off";
    var err = h("p", "auth-err"); err.setAttribute("role", "alert");
    var row = h("div", "auth-row");
    var go = h("button", "auth-btn primary", "Log in"); go.type = "button";
    var cancel = h("button", "auth-btn", "Cancel"); cancel.type = "button";
    row.appendChild(go); row.appendChild(cancel);
    box.appendChild(inp); box.appendChild(err); box.appendChild(row);
    ov.appendChild(box); document.body.appendChild(ov);
    inp.focus();

    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    async function submit() {
      go.disabled = true;
      var r = await login(inp.value, { masterOnly: true });
      go.disabled = false;
      if (r === "admin") { close(); render(); fire(); }
      else { err.textContent = "Invalid key."; inp.value = ""; inp.focus(); }
    }
    go.addEventListener("click", submit);
    cancel.addEventListener("click", close);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); if (e.key === "Escape") close(); });
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
  }

  function render() {
    var slot = document.getElementById("auth-slot");
    if (!slot) return;
    injectStyles();
    slot.textContent = "";
    var wrap = h("span", "auth-wrap");
    if (isAdmin()) {
      wrap.appendChild(h("span", "auth-chip", "MASTER"));
      if (!/market\.html/.test(location.pathname)) {
        var a = h("a", "auth-link", "Add item"); a.href = "market.html#admin"; wrap.appendChild(a);
      }
      var out = h("button", "auth-btn", "Log out"); out.type = "button";
      out.addEventListener("click", logout); wrap.appendChild(out);
    } else {
      var b = h("button", "auth-btn", "Master login"); b.type = "button";
      b.setAttribute("aria-label", "Master login");
      b.addEventListener("click", openModal); wrap.appendChild(b);
    }
    slot.appendChild(wrap);
  }

  window.Auth = { role: role, isAdmin: isAdmin, key: key, login: login, logout: logout };
  document.addEventListener("DOMContentLoaded", render);
})();

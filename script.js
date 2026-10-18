/* script.js — CORNY//STUDIO homepage
   1) animated wallpaper  2) real GitHub activity feed  3) honest studio-session row
   4) real GitHub activity  5) Roblox group count (via relay, optional) */

// Set after you deploy relay-worker.js, e.g. "https://corny-relay.yourname.workers.dev". Empty = skip.
const RELAY_URL = "";
const GITHUB_USER = "corny-studio";
// Your Roblox group ID (public, safe to keep here). Digits only, e.g. "1234567".
const ROBLOX_GROUP_ID = "187537803";

/* ---------- 1. Wallpaper ---------- */
(function () {
  const c = document.getElementById("wallpaper-canvas");
  if (!c) return;
  const ctx = c.getContext("2d");
  let w, h, pts;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function resize() {
    w = c.width = window.innerWidth; h = c.height = window.innerHeight;
    const n = Math.min(70, Math.floor((w * h) / 22000));
    pts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25 }));
  }
  function frame() {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!reduce) { p.x += p.vx; p.y += p.vy; }
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.fillStyle = "rgba(0,240,255,0.55)"; ctx.fillRect(p.x, p.y, 2, 2);
      for (let j = i + 1; j < pts.length; j++) {
        const q = pts[j], d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < 140) { ctx.strokeStyle = "rgba(0,240,255," + (0.12 * (1 - d / 140)) + ")"; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
      }
    }
    if (!reduce) requestAnimationFrame(frame);
  }
  window.addEventListener("resize", resize); resize(); frame();
})();

/* ---------- 2. Recent public GitHub activity (real events) ---------- */
(function () {
  const box = document.getElementById("activity-log");
  if (!box) return;
  const VERB = { PushEvent: "pushed to", CreateEvent: "created", WatchEvent: "starred", ForkEvent: "forked", IssuesEvent: "issue on", PullRequestEvent: "pull request on", ReleaseEvent: "released" };
  function render(evts) {
    box.textContent = "";
    if (!evts.length) { box.textContent = "No public activity yet."; return; }
    evts.slice(0, 6).forEach(function (e) {
      const d = document.createElement("div");
      const when = new Date(e.created_at);
      d.textContent = when.toLocaleDateString() + " " + when.toTimeString().slice(0, 5) + "  " + (VERB[e.type] || e.type) + " " + e.repo;
      box.appendChild(d);
    });
  }
  try {
    const c = JSON.parse(sessionStorage.getItem("gh_events") || "null");
    if (c && Date.now() - c.t < 600000) { render(c.d); return; }
  } catch (e) {}
  box.textContent = "Loading recent activity...";
  fetch("https://api.github.com/users/" + GITHUB_USER + "/events/public?per_page=10")
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      const evts = d.map(function (x) { return { type: x.type, repo: x.repo.name.split("/").pop(), created_at: x.created_at }; });
      try { sessionStorage.setItem("gh_events", JSON.stringify({ t: Date.now(), d: evts })); } catch (e) {}
      render(evts);
    })
    .catch(function () { box.textContent = "Activity unavailable right now."; });
})();

/* ---------- 3. Studio-session row (no live feed connected) ---------- */
(function () {
  const s = document.getElementById("studio-status"), a = document.getElementById("studio-activity");
  if (s) { s.textContent = "NOT CONNECTED"; s.className = "status-idle"; }
  if (a) a.textContent = "No live session feed";
})();

/* ---------- 4. GitHub activity (public API, cached 10 min) ---------- */
(function () {
  const el = document.getElementById("gh-activity");
  if (!el) return;
  function ago(iso) {
    const m = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (m < 60) return m + "m ago"; if (m < 1440) return Math.floor(m / 60) + "h ago"; return Math.floor(m / 1440) + "d ago";
  }
  function show(repos) {
    if (!repos.length) { el.textContent = "GITHUB: no public repos yet"; return; }
    const r = repos[0];
    el.textContent = "GITHUB: " + repos.length + " public repos · latest push: " + r.name + " (" + ago(r.pushed_at) + ")";
  }
  try {
    const cached = JSON.parse(sessionStorage.getItem("gh_cache") || "null");
    if (cached && Date.now() - cached.t < 600000) { show(cached.d); return; }
  } catch (e) {}
  el.textContent = "GITHUB: loading...";
  fetch("https://api.github.com/users/" + GITHUB_USER + "/repos?sort=pushed&per_page=30")
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => { try { sessionStorage.setItem("gh_cache", JSON.stringify({ t: Date.now(), d: d.map(x => ({ name: x.name, pushed_at: x.pushed_at })) })); } catch (e) {} show(d); })
    .catch(() => { el.textContent = "GITHUB: activity unavailable right now"; });
})();

/* ---------- 5. Roblox group member count (via relay) ---------- */
(function () {
  const cell = document.getElementById("member-count");
  if (!cell || !RELAY_URL || !/^\d{1,12}$/.test(ROBLOX_GROUP_ID)) return;
  fetch(RELAY_URL.replace(/\/$/, "") + "/group?id=" + ROBLOX_GROUP_ID)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(j => { if (typeof j.memberCount === "number") cell.textContent = "ONLINE [" + j.memberCount.toLocaleString() + " Members]"; })
    .catch(() => {});
})();

/* ---------- 6. Studio Market toggle + filters ---------- */
(function () {
  const open = document.getElementById("market-toggle-btn");
  const close = document.getElementById("close-market-btn");
  const page = document.getElementById("studio-market-page");
  if (!page) return;
  function show(v) { page.style.display = v ? "block" : "none"; if (v) page.scrollIntoView({ behavior: "smooth", block: "start" }); }
  if (open) open.addEventListener("click", function () { show(page.style.display === "none"); });
  if (close) close.addEventListener("click", function () { show(false); window.scrollTo({ top: 0, behavior: "smooth" }); });

  const btns = page.querySelectorAll(".filter-opt");
  const cards = page.querySelectorAll("[data-cat]");
  const empty = document.getElementById("market-empty");
  btns.forEach(function (b) {
    b.addEventListener("click", function () {
      const f = b.getAttribute("data-filter");
      btns.forEach(function (x) {
        const on = x === b;
        x.style.background = on ? "var(--accent-cyan)" : "var(--bg-card)";
        x.style.color = on ? "#000" : "var(--text-main)";
        x.style.border = on ? "none" : "1px solid var(--border-muted)";
      });
      let n = 0;
      cards.forEach(function (c) { const ok = f === "all" || c.getAttribute("data-cat") === f; c.style.display = ok ? "flex" : "none"; if (ok) n++; });
      if (empty) empty.style.display = n ? "none" : "block";
    });
  });
})();

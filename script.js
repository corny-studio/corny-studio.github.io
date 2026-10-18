/* script.js — CORNY//STUDIO homepage
   1) animated wallpaper  2) real GitHub activity feed  3) honest studio-session row
   4) real GitHub activity  5) Roblox group count (via relay, optional) */

// Settings live in config.js
const CFG = window.CORNY_CONFIG || {};
const RELAY_URL = CFG.relayUrl || "";
const GITHUB_USER = CFG.githubUser || "corny-studio";
const ROBLOX_GROUP_ID = CFG.robloxGroupId || "";

/* ---------- 1. Wallpaper (stars with scroll parallax) ---------- */
(function () {
  const c = document.getElementById("wallpaper-canvas");
  if (!c) return;
  const ctx = c.getContext("2d");
  let w, h, pts;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wrap = function (v, m) { return ((v % m) + m) % m; };

  function resize() {
    w = c.width = window.innerWidth; h = c.height = window.innerHeight;
    const n = Math.min(90, Math.floor((w * h) / 18000));
    // z = depth: near stars (z close to 1) are bigger, brighter and move more when you scroll
    pts = Array.from({ length: n }, function () {
      return { x: Math.random() * w, y: Math.random() * h, z: 0.25 + Math.random() * 0.75,
               vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2 };
    });
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const sy = window.scrollY;
    const pos = pts.map(function (p) {
      return { x: p.x, y: wrap(p.y - sy * p.z * 0.45, h), z: p.z };
    });
    for (let i = 0; i < pos.length; i++) {
      const p = pos[i];
      ctx.fillStyle = "rgba(0,240,255," + (0.25 + p.z * 0.55) + ")";
      const sz = 1 + p.z * 1.8;
      ctx.fillRect(p.x, p.y, sz, sz);
      for (let j = i + 1; j < pos.length; j++) {
        const q = pos[j], d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < 130) {
          ctx.strokeStyle = "rgba(0,240,255," + (0.1 * (1 - d / 130)) + ")";
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
      }
    }
  }

  function frame() {
    pts.forEach(function (p) {
      p.x = wrap(p.x + p.vx, w);
      p.y = wrap(p.y + p.vy, h);
    });
    draw();
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", function () { resize(); draw(); });
  resize();
  if (reduce) { draw(); window.addEventListener("scroll", draw, { passive: true }); }
  else frame();
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

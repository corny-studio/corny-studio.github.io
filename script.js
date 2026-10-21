/* script.js - CORNY//STUDIO homepage
   1) animated wallpaper  2) links for the Roblox group, Discord, Instagram and GitHub  3) real GitHub activity feed
   4) honest studio-session row  5) GitHub summary line  6) Roblox group member count (via relay, optional) */

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

/* ---------- Small helpers for the engine monitor ---------- */
const GH_URL = "https://github.com/" + GITHUB_USER;
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const GROUP_OK = /^\d{1,12}$/.test(ROBLOX_GROUP_ID);
const GROUP_URL = GROUP_OK ? "https://www.roblox.com/groups/" + ROBLOX_GROUP_ID : "https://www.roblox.com";
// optional: add  instagramUrl: "https://www.instagram.com/yourname/"  to config.js
const IG_URL = /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._\/-]+$/.test(CFG.instagramUrl || "") ? CFG.instagramUrl : "https://www.instagram.com/unknf30/";

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function monLink(href, text, title) {
  const a = mk("a", "mon-link", text);
  a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
  if (title) a.title = title;
  return a;
}
function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms)) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  if (m < 1440) return Math.floor(m / 60) + "h ago";
  if (m < 10080) return Math.floor(m / 1440) + "d ago";
  return new Date(iso).toISOString().slice(0, 10);
}
function repoUrl(name) { return SAFE_NAME.test(name) ? GH_URL + "/" + name : GH_URL; }

/* ---------- 2. Links: Roblox group, Discord, GitHub ---------- */
(function () {
  function setHref(id, href) { const a = document.getElementById(id); if (a && href) a.href = href; }
  setHref("link-roblox", GROUP_URL);
  setHref("link-studio", GROUP_URL);
  setHref("member-link", GROUP_URL);
  setHref("link-github", GH_URL);
  setHref("nav-github", GH_URL);
  setHref("nav-roblox", GROUP_URL);
  setHref("nav-instagram", IG_URL);
  setHref("link-instagram", IG_URL);
  setHref("link-engine", GH_URL);
  // optional: add  discordUrl: "https://discord.gg/yourinvite"  to config.js
  const d = CFG.discordUrl || "";
  if (/^https:\/\/(discord\.gg|discord\.com\/invite)\/[A-Za-z0-9_-]+$/.test(d)) setHref("link-discord", d);
})();

/* ---------- 3. Recent public GitHub activity (real events, each one linked) ---------- */
(function () {
  const box = document.getElementById("activity-log");
  if (!box) return;
  const VERB = { PushEvent: "pushed to", CreateEvent: "created", WatchEvent: "starred", ForkEvent: "forked", IssuesEvent: "issue on", PullRequestEvent: "pull request on", ReleaseEvent: "released" };
  function render(evts) {
    box.textContent = "";
    if (!evts.length) { box.textContent = "No public activity yet."; return; }
    evts.slice(0, 6).forEach(function (e) {
      const row = mk("div", "log-row");
      const time = mk("span", "log-time", ago(e.created_at));
      time.title = new Date(e.created_at).toLocaleString();
      const what = mk("span");
      what.appendChild(document.createTextNode((VERB[e.type] || e.type) + " "));
      what.appendChild(monLink(repoUrl(e.repo), e.repo));
      if (e.sha && /^[0-9a-f]{7,40}$/.test(e.sha) && SAFE_NAME.test(e.repo)) {
        what.appendChild(document.createTextNode(" "));
        what.appendChild(monLink(GH_URL + "/" + e.repo + "/commit/" + e.sha, e.sha.slice(0, 7), "Open this commit on GitHub"));
      }
      row.appendChild(time); row.appendChild(what);
      box.appendChild(row);
    });
  }
  try {
    const c = JSON.parse(sessionStorage.getItem("gh_events2") || "null");
    if (c && Date.now() - c.t < 600000) { render(c.d); return; }
  } catch (e) {}
  box.textContent = "Loading recent activity...";
  fetch("https://api.github.com/users/" + GITHUB_USER + "/events/public?per_page=10")
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      const evts = d.map(function (x) { return { type: x.type, repo: x.repo.name.split("/").pop(), created_at: x.created_at, sha: x.payload && x.payload.head ? String(x.payload.head) : "" }; });
      try { sessionStorage.setItem("gh_events2", JSON.stringify({ t: Date.now(), d: evts })); } catch (e) {}
      render(evts);
    })
    .catch(function () { box.textContent = "Activity unavailable right now."; });
})();

/* ---------- 4. Studio-session row (no live feed connected) ---------- */
(function () {
  const s = document.getElementById("studio-status"), a = document.getElementById("studio-activity");
  if (s) { s.textContent = "NOT CONNECTED"; s.className = "status-idle"; }
  if (a) a.textContent = "No live session feed";
})();

/* ---------- 5. GitHub summary line (public API, cached 10 min) ---------- */
(function () {
  const el = document.getElementById("gh-activity");
  if (!el) return;
  function show(repos) {
    el.textContent = "";
    if (!repos.length) { el.textContent = "GitHub: no public repos yet"; return; }
    const r = repos[0];
    el.appendChild(document.createTextNode("GitHub: "));
    el.appendChild(monLink(GH_URL + "?tab=repositories", repos.length + " public repo" + (repos.length === 1 ? "" : "s")));
    el.appendChild(document.createTextNode(" | latest push: "));
    el.appendChild(monLink(repoUrl(r.name), r.name));
    el.appendChild(document.createTextNode(" (" + ago(r.pushed_at) + ")"));
  }
  try {
    const cached = JSON.parse(sessionStorage.getItem("gh_cache") || "null");
    if (cached && Date.now() - cached.t < 600000) { show(cached.d); return; }
  } catch (e) {}
  el.textContent = "GitHub: loading...";
  fetch("https://api.github.com/users/" + GITHUB_USER + "/repos?sort=pushed&per_page=30")
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      const repos = d.map(function (x) { return { name: x.name, pushed_at: x.pushed_at }; });
      try { sessionStorage.setItem("gh_cache", JSON.stringify({ t: Date.now(), d: repos })); } catch (e) {}
      show(repos);
    })
    .catch(function () { el.textContent = "GitHub: activity unavailable right now"; });
})();

/* ---------- 6. Roblox group member count (via relay) ---------- */
(function () {
  const link = document.getElementById("member-link");
  if (!link || !RELAY_URL || !GROUP_OK) return;
  fetch(RELAY_URL.replace(/\/$/, "") + "/group?id=" + ROBLOX_GROUP_ID)
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (j) {
      if (typeof j.memberCount === "number") link.textContent = "ONLINE - " + j.memberCount.toLocaleString() + (j.memberCount === 1 ? " member" : " members");
    })
    .catch(function () {});
})();

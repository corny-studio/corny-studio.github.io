/* badges.js - the badge list for the homepage, in one place.

   Each entry becomes a small chip at the top of the page AND a card under "Technical Architecture Pillars".
   To change a level, edit the tier. To add a badge, copy one line and change the words.

   tier is one of:
     "elite"       purple   Elite Mastery
     "expert"      green    Expert Mastery
     "proficient"  cyan     Proficient
     "hands-on"    amber    Hands-on
   icon is one of: shield, chip, cloud, bolt, lock, cube, branch, chart, users, check, gamepad, spark, wrench, dashboard
   short is the label on the small chip. note is the one-line detail on the card (optional).
   top is optional: a number puts the badge in the strip at the top of the page (1 comes first). Leave it out and
   the badge shows only as a card under "Technical Architecture Pillars", which keeps the strip short.

   Only list what you could talk through if someone asked. The levels are yours to set. */
(function () {
  "use strict";

  var BADGES = [
    { icon: "shield", tier: "elite", short: "DevSecOps", title: "DevSecOps & Systems Automation", top: 1 },
    { icon: "chip", tier: "expert", short: "Full-Stack Game", title: "Full-Stack Game Architecture & Systems Design", top: 2 },
    { icon: "cloud", tier: "proficient", short: "Cloudflare Workers", title: "Serverless APIs on Cloudflare Workers", top: 6,
      note: "Runs a live relay with storage, secrets and several routes." },
    { icon: "bolt", tier: "proficient", short: "Webhooks", title: "Webhooks & Event Pipelines", top: 7,
      note: "Alerts and game events flow into a private API and a live dashboard." },
    { icon: "lock", tier: "hands-on", short: "Secrets", title: "Secrets & Access Control",
      note: "Master-key checks on the server, with passwords kept out of the page." },
    { icon: "cube", tier: "hands-on", short: "Roblox / Luau", title: "Roblox Telemetry & Luau",
      note: "Server-side event reporting and community stats for the studio." },
    { icon: "branch", tier: "proficient", short: "GitHub Pages", title: "Static Site Deployment",
      note: "Ships and debugs a multi-page site straight from a GitHub repo." },
    { icon: "chart", tier: "hands-on", short: "Quant Research", title: "Quantitative Strategy Research",
      note: "Backtests, out-of-sample checks and results verified against TradingView." },

    { icon: "users", tier: "proficient", short: "Moderation", title: "Community Moderation & Management", top: 3,
      note: "Moderates and manages large Roblox and Discord communities." },
    { icon: "check", tier: "proficient", short: "Game Testing & QA", title: "Game Testing & QA", top: 4,
      note: "Finds, reproduces and reports bugs in live games." },
    { icon: "gamepad", tier: "proficient", short: "Roblox Dev", title: "Roblox Game Development", top: 5,
      note: "Builds games, lobbies and community spaces in Roblox Studio." },
    { icon: "spark", tier: "proficient", short: "AI-Assisted Dev", title: "AI-Assisted Development", top: 8,
      note: "Directs big builds with AI tools and checks what comes back." },
    { icon: "wrench", tier: "proficient", short: "Debugging", title: "Debugging & Troubleshooting",
      note: "Tracks down file, setting and cache problems and confirms the fix." },
    { icon: "dashboard", tier: "hands-on", short: "Dashboards", title: "Live Data Dashboards",
      note: "Dashboards for community, GitHub and system stats." }
  ];


  var ICONS = {
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    chip: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    cube: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/>',
    branch: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    chart: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
    gamepad: '<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15" cy="11" r="1"/><circle cx="18" cy="13" r="1"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15v4M17 17h4"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>'
  };
  var LEVELS = { elite: "Elite Mastery", expert: "Expert Mastery", proficient: "Proficient", "hands-on": "Hands-on" };
  var NS = "http://www.w3.org/2000/svg";

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function icon(name, cls) {
    var s = document.createElementNS ? document.createElementNS(NS, "svg") : document.createElement("svg");
    s.setAttribute("class", cls);
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = ICONS[name] || ICONS.chip;
    return s;
  }
  function valid(b) { return b && LEVELS[b.tier] && b.title && b.short; }

  function render() {
    var top = document.getElementById("top-badges"), cards = document.getElementById("pillar-badges");
    var list = BADGES.filter(valid);
    if (top) {
      top.textContent = "";
      list.filter(function (b) { return typeof b.top === "number"; }).sort(function (a, c) { return a.top - c.top; }).forEach(function (b) {
        var a = el("a", "chip " + b.tier); a.href = "#architecture"; a.title = b.title + ": " + LEVELS[b.tier];
        a.appendChild(icon(b.icon, "chip-icon"));
        a.appendChild(el("span", "chip-name", b.short));
        a.appendChild(el("em", "chip-level", b.tier === "hands-on" ? "Hands-on" : b.tier === "proficient" ? "Proficient" : b.tier === "elite" ? "Elite" : "Expert"));
        top.appendChild(a);
      });
    }
    if (cards) {
      cards.textContent = "";
      list.forEach(function (b) {
        var c = el("div", "mini-badge " + b.tier);
        c.appendChild(icon(b.icon, "badge-icon"));
        var info = el("div", "badge-info");
        info.appendChild(el("span", "badge-title", b.title));
        info.appendChild(el("span", "badge-status", LEVELS[b.tier]));
        if (b.note) info.appendChild(el("span", "badge-note", b.note));
        c.appendChild(info);
        cards.appendChild(c);
      });
    }
  }

  window.CornyBadges = { list: BADGES, render: render, levels: LEVELS };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
})();

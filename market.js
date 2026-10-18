/* market.js — CORNY//STUDIO market page.
   Items come from three places: BUILT_IN (below), the relay (published from the admin form), and
   unsaved previews (admin form with no relay connected). Everything is drawn with textContent. */
(function () {
  "use strict";

  var cfg = window.CORNY_CONFIG || {};
  var RELAY = (cfg.relayUrl || "").replace(/\/$/, "");

  var BUILT_IN = [
    {
      name: "Premium Lobby Center Fountain",
      price: "R$ 1,000",
      cat: "Models",
      status: "Immediate Asset ID Delivery // Unlimited Stock",
      desc: "A premium, optimized showcase lobby centerpiece fountain. Featuring customized particle beam physics emitters, high-fidelity geometry layouts, and lightweight structural optimization to ensure high frame rates on any target platform hardware. Ready for instant deployment via asset ID synchronization.",
      rights: "Full reuse rights across your account universes. Modification allowed. Resale or source file leaking is strictly forbidden.",
      fulfillment: "Direct delivery of the Roblox Studio asset file link ID straight to your account upon verified transfer.",
      contact: "Submit an integration ticket or connection query inside the official Corny Games Studio community cluster.",
      // Discord CDN links expire. Save the image in the repo (e.g. fountain.png) and use: img: "fountain.png"
      img: "https://cdn.discordapp.com/attachments/1475336835126526044/1560597740235530280/image.png?ex=6ad34b67&is=6ad1f9e7&hm=0b27d861e5e7813f312b472d4a7f68370a503d15f76e711859c29e87ba83a334&",
      alt: "Roblox Studio Premium Fountain Asset Showcase",
      link: "https://roblox.com",
      linkLabel: "View Developer Group Marketplace"
    }
  ];

  var remote = [];
  var previews = [];

  var grid = document.getElementById("market-grid");
  var bar = document.getElementById("filters");
  var empty = document.getElementById("market-empty");
  var adminBox = document.getElementById("admin-panel");
  var formEl = document.getElementById("item-form");
  var msg = document.getElementById("form-msg");
  var codeOut = document.getElementById("code-out");
  var codeText = document.getElementById("code-text");
  if (!grid || !bar) return;

  /* ---------- helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function safeUrl(u) {
    u = (u || "").trim();
    return /^https:\/\//i.test(u) || /^[\w\-./]+\.(png|jpe?g|gif|webp|svg)$/i.test(u) ? u : "";
  }
  function safeLink(u) { u = (u || "").trim(); return /^https:\/\//i.test(u) ? u : ""; }
  function isAdmin() { return !!(window.Auth && window.Auth.isAdmin()); }
  function allItems() { return BUILT_IN.concat(remote, previews); }

  function fact(label, value) {
    var d = el("div", "fact");
    d.appendChild(el("strong", "", label + ": "));
    d.appendChild(document.createTextNode(value));
    return d;
  }

  /* ---------- cards ---------- */
  function card(item) {
    var c = el("article", "card");
    c.setAttribute("data-cat", item.cat || "Other");

    var media = el("div", "card-media");
    var src = safeUrl(item.img);
    if (src) {
      var img = document.createElement("img");
      img.src = src; img.alt = item.alt || item.name; img.loading = "lazy";
      img.onerror = function () { media.textContent = ""; media.appendChild(el("div", "img-missing", "Image unavailable")); };
      media.appendChild(img);
    } else {
      media.appendChild(el("div", "img-missing", "No image"));
    }
    c.appendChild(media);

    var body = el("div", "card-body");
    var top = el("div", "card-top");
    top.appendChild(el("h3", "", item.name));
    top.appendChild(el("span", "price", item.price));
    body.appendChild(top);
    if (item.status) body.appendChild(el("span", "tag", "[Status: " + item.status + "]"));
    body.appendChild(el("p", "desc", item.desc));

    var facts = el("div", "facts");
    if (item.rights) facts.appendChild(fact("Rights", item.rights));
    if (item.fulfillment) facts.appendChild(fact("Fulfillment", item.fulfillment));
    if (item.contact) facts.appendChild(fact("Contact", item.contact));
    var href = safeLink(item.link);
    if (href) {
      var a = el("a", "buy", item.linkLabel || "View on Roblox");
      a.href = href; a.target = "_blank"; a.rel = "noopener";
      facts.appendChild(a);
    }
    if (isAdmin() && item.id) {
      var del = el("button", "danger", "Delete this item"); del.type = "button";
      del.addEventListener("click", function () { removeRemote(item.id); });
      facts.appendChild(del);
    }
    if (isAdmin() && item._preview) {
      var rm = el("button", "danger", "Remove preview"); rm.type = "button";
      rm.addEventListener("click", function () { previews = previews.filter(function (p) { return p !== item; }); render(); });
      facts.appendChild(rm);
    }
    body.appendChild(facts);
    c.appendChild(body);
    return c;
  }

  /* ---------- render + filters ---------- */
  function setFilter(f, btn) {
    Array.prototype.forEach.call(bar.children, function (b) { b.classList.toggle("active", b === btn); });
    var shown = 0;
    Array.prototype.forEach.call(grid.children, function (c) {
      var ok = f === "all" || c.getAttribute("data-cat") === f;
      c.style.display = ok ? "" : "none";
      if (ok) shown++;
    });
    empty.style.display = shown ? "none" : "block";
  }

  function addFilter(label, f, active) {
    var b = el("button", "filter" + (active ? " active" : ""), label);
    b.type = "button";
    b.addEventListener("click", function () { setFilter(f, b); });
    bar.appendChild(b);
  }

  function render() {
    var items = allItems();
    grid.textContent = ""; bar.textContent = "";
    items.forEach(function (it) { grid.appendChild(card(it)); });

    var cats = [];
    items.forEach(function (it) { var c = it.cat || "Other"; if (cats.indexOf(c) === -1) cats.push(c); });
    addFilter("All (" + items.length + ")", "all", true);
    cats.forEach(function (cat) {
      var n = items.filter(function (i) { return (i.cat || "Other") === cat; }).length;
      addFilter(cat + " (" + n + ")", cat, false);
    });
    empty.style.display = items.length ? "none" : "block";
  }

  /* ---------- relay: load / publish / delete ---------- */
  function loadRemote() {
    if (!RELAY) return;
    fetch(RELAY + "/market", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { remote = Array.isArray(j.items) ? j.items : []; render(); })
      .catch(function () { /* relay down: built-in items still show */ });
  }

  function say(text, bad) { if (msg) { msg.textContent = text; msg.className = bad ? "bad" : "good"; } }

  function removeRemote(id) {
    if (!confirm("Delete this item from the market?")) return;
    fetch(RELAY + "/market?id=" + encodeURIComponent(id), { method: "DELETE", headers: { "X-Admin-Key": window.Auth.key() } })
      .then(function (r) {
        if (r.status === 403) throw new Error("Not authorized. Log in again.");
        if (!r.ok) throw new Error("Delete failed (" + r.status + ").");
        loadRemote();
      })
      .catch(function (e) { alert(e.message); });
  }

  function readForm() {
    function v(id) { return (document.getElementById(id).value || "").trim(); }
    return {
      name: v("f-name"), price: v("f-price"), cat: v("f-cat") || "Models",
      status: v("f-status") || "Immediate Asset ID Delivery", desc: v("f-desc"),
      rights: v("f-rights"), fulfillment: v("f-fulfillment"), contact: v("f-contact"),
      img: v("f-img"), alt: v("f-name"), link: v("f-link"), linkLabel: v("f-linklabel") || "View on Roblox"
    };
  }

  function submit(e) {
    e.preventDefault();
    if (!isAdmin()) { say("Log in as master first.", true); return; }
    var item = readForm();
    if (!item.name || !item.price || !item.desc) { say("Name, price and description are required.", true); return; }
    if (item.img && !safeUrl(item.img)) { say("Image must be an https:// link or a file in the repo like fountain.png.", true); return; }
    if (item.link && !safeLink(item.link)) { say("Link must start with https://", true); return; }

    if (RELAY) {
      say("Publishing...", false);
      fetch(RELAY + "/market", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Key": window.Auth.key() },
        body: JSON.stringify({ item: item })
      }).then(function (r) {
        if (r.status === 403) throw new Error("Not authorized. Log in again.");
        if (!r.ok) return r.text().then(function (t) { throw new Error(t || "Publish failed."); });
        formEl.reset(); codeOut.hidden = true; say("Published. Everyone can see it now.", false); loadRemote();
      }).catch(function (err) { say(err.message, true); });
    } else {
      previews.push(Object.assign({ _preview: true }, item));
      codeText.value = JSON.stringify(item, null, 2) + ",";
      codeOut.hidden = false;
      say("Preview only (no relay connected). Copy the code below into ITEMS in market.js and commit to publish it.", false);
      render();
    }
  }

  /* ---------- admin UI visibility ---------- */
  function syncAdmin() {
    if (adminBox) adminBox.hidden = !isAdmin();
    render();
  }

  if (formEl) formEl.addEventListener("submit", submit);
  var copyBtn = document.getElementById("copy-code");
  if (copyBtn) copyBtn.addEventListener("click", function () {
    codeText.select();
    try { document.execCommand("copy"); say("Copied.", false); } catch (e) { say("Select the text and copy it manually.", true); }
  });

  window.addEventListener("corny-auth", syncAdmin);
  document.addEventListener("DOMContentLoaded", function () { syncAdmin(); loadRemote(); });
  if (document.readyState !== "loading") { syncAdmin(); loadRemote(); }
})();

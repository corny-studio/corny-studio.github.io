/* make.js - a one-time helper for make.html.
   It reads this site's old background.html, takes the scene script out of it, removes the optional loader that
   injected a script at runtime, works out three.js's integrity hash from the file cdnjs serves right now, and
   downloads the two new files. It changes nothing on the site and sends nothing anywhere.
   If the old file is not what it expects, it downloads nothing and says why. Delete it after use. */
(function () {
  "use strict";

  var THREE = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";

  // The scene script: everything between <script> and </script> at the end of the old page.
  function extractScript(old) {
    if (old.length < 100000) throw new Error("This background.html is too small to hold the scene script. It may already be the new version, so there is nothing to do.");
    var m = /<script>\s*(\(function \(\) \{[\s\S]*\}\)\(\);)\s*<\/script>\s*<\/body>\s*<\/html>\s*$/.exec(old);
    if (!m) throw new Error("Could not find the scene script in background.html. Nothing was downloaded.");
    return m[1];
  }

  // Remove the optional ISS-model loader (it only ran with ?real=1 and injected a script at runtime) and the line that called it.
  function removeLoader(js) {
    var a = js.indexOf("function loadISSModel()"), b = js.indexOf("/* ---------- the tour clock");
    if (a < 0 || b < a) throw new Error("Could not find the loadISSModel function. Nothing was downloaded.");
    var out = (js.slice(0, a) + js.slice(b)).replace("loadCatalog(); loadISSModel(); }", "loadCatalog(); }");
    if (/loadISSModel\s*\(/.test(out)) throw new Error("loadISSModel is still being called. Nothing was downloaded.");
    return out;
  }

  // The new background.html: no script inside, three.js pinned by its hash, the scene loaded from background.js.
  function pageHtml(sri) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Cosmic background</title>
<style>
    :root {
        color-scheme: dark;
        box-sizing: border-box;
        padding-top: env(safe-area-inset-top, 0px);
        padding-bottom: env(safe-area-inset-bottom, 0px);
        --bg: #000000;
        --fg: #cfe6f2;
        --accent: #19f3ff;
    }
    @media (prefers-color-scheme: dark) {
        :root:not([data-theme="light"]) { --bg: #000000; --fg: #cfe6f2; --accent: #19f3ff; }
    }
    :root[data-theme="dark"] { --bg: #000000; --fg: #cfe6f2; --accent: #19f3ff; }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; background: var(--bg); overflow-x: hidden; }
    body { min-height: 100%; color: var(--fg); }

    #moving-background { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 0; pointer-events: none; display: block; }
    .scroll-timeline-trigger { position: relative; z-index: 1; width: 100%; height: 1400vh; pointer-events: none; }

    #veil { position: fixed; z-index: 2; inset: 0; background: #000000; pointer-events: none; opacity: 1; transition: opacity 2.8s ease; }
    #load { position: fixed; z-index: 3; left: 0; right: 0; top: 0; height: 2px; pointer-events: none; transition: opacity 1.2s ease 0.4s; }
    #load i { display: block; height: 100%; width: 0%; background: var(--accent); transition: width 0.4s ease; }
    #load.done { opacity: 0; }
    #fallback { display: none; position: fixed; z-index: 4; inset: 0; align-items: center; justify-content: center; text-align: center; padding: 24px; font: 14px/1.6 ui-monospace, Menlo, Consolas, monospace; color: var(--fg); }
</style>
<script src="${THREE}" integrity="${sri}" crossorigin="anonymous"></script>
</head>
<body>

<canvas id="moving-background"></canvas>
<div class="scroll-timeline-trigger"></div>
<div id="veil" aria-hidden="true"></div>
<div id="load" aria-hidden="true"><i></i></div>
<div id="fallback" role="alert"></div>

<script src="background.js"></script>
</body>
</html>
`;
  }

  async function sha512Base64(buf) {
    var digest = await crypto.subtle.digest("SHA-512", buf);
    return "sha512-" + btoa(String.fromCharCode.apply(null, new Uint8Array(digest)));
  }

  async function build(readOld, readThree) {
    var js = removeLoader(extractScript(await readOld()));
    var buf = await readThree();
    if (buf.byteLength < 400000 || buf.byteLength > 1500000) throw new Error("three.min.js is not the expected size. Nothing was downloaded.");
    var sri = await sha512Base64(buf);
    return { js: js, html: pageHtml(sri), sri: sri };
  }

  if (typeof module !== "undefined" && module.exports) { module.exports = { extractScript: extractScript, removeLoader: removeLoader, pageHtml: pageHtml, build: build }; }
  if (typeof document === "undefined") return;

  var button = document.getElementById("build"), status = document.getElementById("status");
  function say(text, cls) { status.textContent = text; status.className = cls || ""; }
  function save(name, text) {
    var link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  button.addEventListener("click", async function () {
    button.disabled = true;
    say("Working…");
    try {
      if (!(window.crypto && crypto.subtle)) throw new Error("This page cannot compute hashes. Open it from the https:// address of your site.");
      var r = await build(
        async function () { var res = await fetch("background.html", { cache: "no-store" }); if (!res.ok) throw new Error("Could not read background.html (HTTP " + res.status + ")."); return res.text(); },
        async function () { var res = await fetch(THREE); if (!res.ok) throw new Error("Could not read three.js from cdnjs (HTTP " + res.status + ")."); return res.arrayBuffer(); }
      );
      save("background.js", r.js);
      setTimeout(function () { save("background.html", r.html); }, 800);
      say("Done. Two files were downloaded:\n  background.js (" + Math.round(r.js.length / 1024) + " KB)\n  background.html (" + Math.round(r.html.length / 1024) + " KB)\n\nthree.js integrity hash:\n" + r.sri + "\n\nIf your browser asked to allow multiple downloads, choose Allow.", "ok");
    } catch (e) {
      say(e.message, "bad");
    }
    button.disabled = false;
  });
})();

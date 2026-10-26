/* scroll-sync.js
   Tells the space background (background.html) how far down the page you are,
   from 0 at the top to 1 at the bottom, so the camera flies as you scroll.
   It sends one number and nothing else. */
(function () {
  "use strict";
  var frame = document.getElementById("space-hull");
  if (!frame) return;

  // Opened from a file, the origin is "null" and can't be named, so any target is allowed in that case.
  var target = (location.origin && location.origin !== "null" && location.protocol !== "file:") ? location.origin : "*";
  var queued = false;

  function send() {
    queued = false;
    if (!frame.contentWindow) return;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    frame.contentWindow.postMessage({ scrollProgress: p }, target);
  }

  function queue() {
    if (!queued) { queued = true; requestAnimationFrame(send); }
  }

  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue);
  frame.addEventListener("load", function () {
    // If background.html is missing, the frame would show a 404 page over yours, so hide it.
    try {
      if (!frame.contentDocument.getElementById("moving-background")) frame.style.display = "none";
    } catch (e) { /* cross-origin or blocked: leave it as is */ }
    queue();
  });
})();

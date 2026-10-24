(function() {
  var href = String(location.href || "");
  if (!href || href === "about:blank") return "wait";
  if (document.title === "Just a moment..." || document.querySelector('#challenge-running, #challenge-stage, #cf-challenge-running, script[src*="challenges.cloudflare.com"]')) return "challenge";
  if (document.readyState === "loading" || !document.body || document.body.innerHTML.trim().length < 200) return "wait";
  if (document.querySelector('script[src*="katex"]') && !document.querySelector(".katex") && document.readyState !== "complete") return "wait";
  var dm = document.querySelector("d-math, d-cite");
  if (dm && !dm.shadowRoot) return "wait";
  return "ready";
})()

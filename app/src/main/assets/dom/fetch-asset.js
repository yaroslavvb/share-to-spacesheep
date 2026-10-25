// Shared in-page asset fetcher for DomSnapshotter (Android) and SpacesheepDomSnapshot (iOS).
// Evaluates inside the snapshot WebView so same-origin / Cloudflare cookies are reused.
(async function (u, maxBytes) {
  try {
    var r;
    try { r = await fetch(u, { credentials: "same-origin", cache: "force-cache" }); } catch (e) {}
    if (!r || !r.ok) { try { r = await fetch(u, { credentials: "same-origin" }); } catch (e) {} }
    if (!r || !r.ok) { try { r = await fetch(u, { credentials: "include", cache: "force-cache" }); } catch (e) {} }
    if (!r || !r.ok) r = await fetch(u, { credentials: "include" });
    if (!r.ok) return JSON.stringify({ ok: false, error: "HTTP " + r.status });
    var cl = Number(r.headers.get("content-length") || 0);
    if (cl > maxBytes) return JSON.stringify({ ok: false, error: "too_big" });
    var blob = await r.blob();
    if (blob.size > maxBytes) return JSON.stringify({ ok: false, error: "too_big" });
    var b64 = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onloadend = function () {
        var res = String(reader.result || "");
        var idx = res.indexOf(",");
        resolve(idx >= 0 ? res.slice(idx + 1) : "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return JSON.stringify({
      ok: true,
      base64: b64,
      contentType: blob.type || r.headers.get("content-type") || "",
      finalUrl: r.url || u,
    });
  } catch (err) {
    return JSON.stringify({ ok: false, error: String((err && err.message) || err) });
  }
})

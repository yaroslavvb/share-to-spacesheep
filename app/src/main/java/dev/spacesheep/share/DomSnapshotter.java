package dev.spacesheep.share;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * Offscreen WebView that renders shared pages to capture post-JS DOM state and <canvas> bitmaps,
 * while rejecting Chromium error pages and cleaning up to avoid background resource leaks.
 */
public final class DomSnapshotter {
    public interface SnapshotCallback {
        void onSnapshotReady(JSONObject result);
        void onAssetReady(JSONObject result);
    }

    private static final String SNAPSHOT_JS = "(function(){" +
            "try {" +
            "  var href = String(location.href || '');" +
            "  if (!href || href === 'about:blank' || href.indexOf('chrome-error:') === 0) {" +
            "    return JSON.stringify({ ok: false, error: 'error_page' });" +
            "  }" +
            "  if (document.querySelector('#main-frame-error, .neterror')) {" +
            "    return JSON.stringify({ ok: false, error: 'neterror' });" +
            "  }" +
            "  var d = document.doctype;" +
            "  var dt = d ? '<!DOCTYPE ' + d.name + (d.publicId ? ' PUBLIC \"' + d.publicId + '\"' : '') + (d.systemId ? ' \"' + d.systemId + '\"' : '') + '>' : '<!DOCTYPE html>';" +
            "  var root = document.documentElement.cloneNode(true);" +
            "  var origCanvases = document.querySelectorAll('canvas');" +
            "  var cloneCanvases = root.querySelectorAll('canvas');" +
            "  for (var i = 0; i < origCanvases.length && i < cloneCanvases.length; i++) {" +
            "    try {" +
            "      var c = origCanvases[i];" +
            "      if (c.width > 0 && c.height > 0) {" +
            "        var dataUrl = c.toDataURL('image/png');" +
            "        if (dataUrl && dataUrl.length > 64) {" +
            "          var img = document.createElement('img');" +
            "          img.setAttribute('src', dataUrl);" +
            "          if (c.getAttribute('class')) img.setAttribute('class', c.getAttribute('class'));" +
            "          if (c.getAttribute('style')) img.setAttribute('style', c.getAttribute('style'));" +
            "          cloneCanvases[i].replaceWith(img);" +
            "        }" +
            "      }" +
            "    } catch(e) {}" +
            "  }" +
            "  var origStyles = document.querySelectorAll('style');" +
            "  var cloneStyles = root.querySelectorAll('style');" +
            "  for (var sIdx = 0; sIdx < origStyles.length && sIdx < cloneStyles.length; sIdx++) {" +
            "    try {" +
            "      var origS = origStyles[sIdx], cloneS = cloneStyles[sIdx];" +
            "      var rawCss = (origS.textContent || '').replace(/<!--[\\s\\S]*?-->/g, '');" +
            "      var sheetCss = '';" +
            "      if (origS.sheet && origS.sheet.cssRules) {" +
            "        var rules = [];" +
            "        for (var rIdx = 0; rIdx < origS.sheet.cssRules.length; rIdx++) {" +
            "          rules.push(origS.sheet.cssRules[rIdx].cssText);" +
            "        }" +
            "        sheetCss = rules.join('\\n');" +
            "      }" +
            "      cloneS.textContent = (rawCss.trim().length === 0 && sheetCss.length > 0) ? sheetCss : (sheetCss.length > rawCss.length ? sheetCss : rawCss);" +
            "    } catch(e) {}" +
            "  }" +
            "  if (document.adoptedStyleSheets && document.adoptedStyleSheets.length > 0) {" +
            "    var headEl = root.querySelector('head') || root;" +
            "    for (var aIdx = 0; aIdx < document.adoptedStyleSheets.length; aIdx++) {" +
            "      try {" +
            "        var aSheet = document.adoptedStyleSheets[aIdx];" +
            "        if (aSheet && aSheet.cssRules && aSheet.cssRules.length > 0) {" +
            "          var aRules = [];" +
            "          for (var ar = 0; ar < aSheet.cssRules.length; ar++) aRules.push(aSheet.cssRules[ar].cssText);" +
            "          var aStyle = document.createElement('style');" +
            "          aStyle.setAttribute('data-adopted-ss', String(aIdx));" +
            "          aStyle.textContent = aRules.join('\\n');" +
            "          headEl.appendChild(aStyle);" +
            "        }" +
            "      } catch(e) {}" +
            "    }" +
            "  }" +
            "  var origImgs = document.querySelectorAll('img');" +
            "  var cloneImgs = root.querySelectorAll('img');" +
            "  for (var mIdx = 0; mIdx < origImgs.length && mIdx < cloneImgs.length; mIdx++) {" +
            "    try {" +
            "      var oImg = origImgs[mIdx], cImg = cloneImgs[mIdx];" +
            "      cImg.removeAttribute('loading');" +
            "      cImg.removeAttribute('decoding');" +
            "      var curSrc = cImg.getAttribute('src') || '';" +
            "      var lazySrc = cImg.getAttribute('data-src') || cImg.getAttribute('data-lazy-src') || cImg.getAttribute('data-original') || cImg.getAttribute('data-actualsrc') || '';" +
            "      if (lazySrc && (!curSrc || curSrc.indexOf('data:') === 0 || curSrc === 'about:blank')) {" +
            "        cImg.setAttribute('src', lazySrc);" +
            "      } else if ((!curSrc || curSrc.indexOf('data:') === 0) && oImg.currentSrc && /^https?:/i.test(oImg.currentSrc)) {" +
            "        cImg.setAttribute('src', oImg.currentSrc);" +
            "      }" +
            "      var lazySrcset = cImg.getAttribute('data-srcset') || cImg.getAttribute('data-lazy-srcset') || '';" +
            "      if (lazySrcset && !cImg.getAttribute('srcset')) {" +
            "        cImg.setAttribute('srcset', lazySrcset);" +
            "      }" +
            "      if (cImg.style && cImg.style.opacity === '0') cImg.style.opacity = '';" +
            "    } catch(e) {}" +
            "  }" +
            "  var cloneSources = root.querySelectorAll('source[data-srcset], source[data-lazy-srcset]');" +
            "  for (var csIdx = 0; csIdx < cloneSources.length; csIdx++) {" +
            "    var cs = cloneSources[csIdx];" +
            "    var lss = cs.getAttribute('data-srcset') || cs.getAttribute('data-lazy-srcset') || '';" +
            "    if (lss && !cs.getAttribute('srcset')) cs.setAttribute('srcset', lss);" +
            "  }" +
            "  var overlays = root.querySelectorAll('.osano-cm-window, #onetrust-consent-sdk, #onetrust-banner-sdk, #CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay, .qc-cmp2-container, .fc-consent-root, #truste-consent-track, #didomi-host, #usercentrics-root, .cky-consent-container, .cc-window, .cc-revoke, #cookie-law-info-bar, #cookie-notice, #iubenda-cs-banner, [id^=\"sp_message_container\"], .cmplz-cookiebanner-container, #BorlabsCookieBox, #gdpr-cookie-message, .mw-notification-area, .postedit-container, noscript');" +
            "  for (var oIdx = 0; oIdx < overlays.length; oIdx++) overlays[oIdx].remove();" +
            "  var bodyEl = root.querySelector('body');" +
            "  if (bodyEl && bodyEl.style && bodyEl.style.overflow === 'hidden') bodyEl.style.overflow = '';" +
            "  if (root.style && root.style.overflow === 'hidden') root.style.overflow = '';" +
            "  var scripts = root.querySelectorAll('script');" +
            "  for (var j = 0; j < scripts.length; j++) {" +
            "    var s = scripts[j];" +
            "    var t = (s.getAttribute('type') || '').trim().toLowerCase();" +
            "    if (!t || t === 'module' || /(java|ecma)script/.test(t)) s.remove();" +
            "  }" +
            "  var links = root.querySelectorAll('link[rel~=\"modulepreload\" i], link[rel~=\"preload\" i][as=\"script\" i]');" +
            "  for (var k = 0; k < links.length; k++) links[k].remove();" +
            "  return JSON.stringify({ ok: true, html: dt + '\\n' + root.outerHTML, title: document.title || '', finalUrl: href });" +
            "} catch(err) { return JSON.stringify({ ok: false, error: String(err) }); }" +
            "})()";

    private final WebView webView;
    private final Handler mainHandler;
    private final SnapshotCallback callback;
    private final String userAgent;

    private int activeId = 0;
    private Runnable timeoutTask = null;
    private Runnable settleTask = null;

    @SuppressLint("SetJavaScriptEnabled")
    public DomSnapshotter(Context context, Handler mainHandler, SnapshotCallback callback) {
        this.mainHandler = mainHandler;
        this.callback = callback;
        this.webView = new WebView(context);
        this.webView.setVisibility(View.INVISIBLE);
        this.webView.setSoundEffectsEnabled(false);

        WebSettings s = this.webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        String defaultUa = s.getUserAgentString();
        if (defaultUa != null && !defaultUa.isEmpty()) {
            this.userAgent = defaultUa.replace("; wv)", ")").replace("Version/4.0 ", "");
        } else {
            this.userAgent = NativeHttpClient.DEFAULT_USER_AGENT;
        }
        s.setUserAgentString(this.userAgent);

        this.webView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void onAssetFetched(int id, String json) {
                try {
                    JSONObject obj = new JSONObject(json != null ? json : "{}");
                    obj.put("id", id);
                    callback.onAssetReady(obj);
                } catch (Exception e) {
                    try {
                        JSONObject err = new JSONObject();
                        err.put("id", id);
                        err.put("ok", false);
                        err.put("error", e.toString());
                        callback.onAssetReady(err);
                    } catch (Exception ignored) {
                    }
                }
            }
        }, "AndroidSnapshotBridge");

        this.webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                final int snapId = activeId;
                if (snapId <= 0 || "about:blank".equals(url)) return;
                scheduleCheckOrExtract(snapId, 750);
            }
        });
    }

    public String getUserAgent() {
        return userAgent;
    }

    private void scheduleCheckOrExtract(final int snapId, final long delayMs) {
        if (settleTask != null) {
            mainHandler.removeCallbacks(settleTask);
        }
        settleTask = () -> {
            if (activeId != snapId) return;
            webView.evaluateJavascript(
                    "(function(){ return !!(document.title === 'Just a moment...' || document.querySelector('#challenge-running, #challenge-stage, #cf-challenge-running, script[src*=\"challenges.cloudflare.com\"]')); })()",
                    val -> {
                        if (activeId != snapId) return;
                        if ("true".equals(val)) {
                            scheduleCheckOrExtract(snapId, 900);
                        } else {
                            extractSnapshot(snapId);
                        }
                    });
        };
        mainHandler.postDelayed(settleTask, delayMs);
    }

    public WebView getWebView() {
        return webView;
    }

    public void startSnapshot(final int id, final String url, final int timeoutMs) {
        mainHandler.post(() -> {
            cancelPendingCallbacks();
            activeId = id;
            timeoutTask = () -> {
                if (activeId == id) {
                    extractSnapshot(id);
                }
            };
            mainHandler.postDelayed(timeoutTask, Math.max(1500, timeoutMs));
            webView.stopLoading();
            webView.loadUrl(url);
        });
    }

    public void fetchAsset(final int id, final String url, final long maxBytes) {
        mainHandler.post(() -> {
            String js = "(async function() {" +
                    "  try {" +
                    "    var u = " + JSONObject.quote(url) + ";" +
                    "    var r;" +
                    "    try { r = await fetch(u, { credentials: 'include', cache: 'force-cache' }); } catch(e) {}" +
                    "    if (!r || !r.ok) r = await fetch(u, { credentials: 'include' });" +
                    "    if (!r.ok) {" +
                    "      window.AndroidSnapshotBridge.onAssetFetched(" + id + ", JSON.stringify({ ok: false, error: 'HTTP ' + r.status }));" +
                    "      return;" +
                    "    }" +
                    "    var blob = await r.blob();" +
                    "    if (blob.size > " + maxBytes + ") {" +
                    "      window.AndroidSnapshotBridge.onAssetFetched(" + id + ", JSON.stringify({ ok: false, error: 'too_big' }));" +
                    "      return;" +
                    "    }" +
                    "    var b64 = await new Promise(function(resolve, reject) {" +
                    "      var reader = new FileReader();" +
                    "      reader.onloadend = function() {" +
                    "        var res = String(reader.result || '');" +
                    "        var idx = res.indexOf(',');" +
                    "        resolve(idx >= 0 ? res.slice(idx + 1) : '');" +
                    "      };" +
                    "      reader.onerror = reject;" +
                    "      reader.readAsDataURL(blob);" +
                    "    });" +
                    "    window.AndroidSnapshotBridge.onAssetFetched(" + id + ", JSON.stringify({" +
                    "      ok: true," +
                    "      base64: b64," +
                    "      contentType: blob.type || r.headers.get('content-type') || ''," +
                    "      finalUrl: r.url || u" +
                    "    }));" +
                    "  } catch (err) {" +
                    "    window.AndroidSnapshotBridge.onAssetFetched(" + id + ", JSON.stringify({ ok: false, error: String(err && err.message || err) }));" +
                    "  }" +
                    "})()";
            webView.evaluateJavascript(js, null);
        });
    }

    public void resetToBlank() {
        mainHandler.post(() -> {
            cancelPendingCallbacks();
            activeId = 0;
            try {
                webView.stopLoading();
                webView.loadUrl("about:blank");
            } catch (Exception ignored) {
            }
        });
    }

    private void extractSnapshot(final int snapId) {
        if (activeId != snapId) return;
        activeId = 0;
        cancelPendingCallbacks();
        try {
            android.webkit.CookieManager.getInstance().flush();
        } catch (Exception ignored) {
        }

        webView.evaluateJavascript(SNAPSHOT_JS, value -> {
            JSONObject res = new JSONObject();
            try {
                Object parsed = new JSONTokener(value).nextValue();
                if (parsed instanceof String) {
                    res = new JSONObject((String) parsed);
                }
                res.put("id", snapId);
            } catch (Exception e) {
                try {
                    res.put("id", snapId);
                    res.put("ok", false);
                } catch (Exception ignored) {
                }
            }
            callback.onSnapshotReady(res);
        });
    }

    private void cancelPendingCallbacks() {
        if (timeoutTask != null) {
            mainHandler.removeCallbacks(timeoutTask);
            timeoutTask = null;
        }
        if (settleTask != null) {
            mainHandler.removeCallbacks(settleTask);
            settleTask = null;
        }
    }

    public void destroy() {
        cancelPendingCallbacks();
        try {
            if (webView.getParent() instanceof android.view.ViewGroup) {
                ((android.view.ViewGroup) webView.getParent()).removeView(webView);
            }
            webView.stopLoading();
            webView.destroy();
        } catch (Exception ignored) {
        }
    }
}

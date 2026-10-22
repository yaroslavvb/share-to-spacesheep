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
        s.setUserAgentString(NativeHttpClient.USER_AGENT);

        this.webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                final int snapId = activeId;
                if (snapId <= 0 || "about:blank".equals(url)) return;
                if (settleTask != null) {
                    mainHandler.removeCallbacks(settleTask);
                }
                settleTask = () -> {
                    if (activeId == snapId) {
                        extractSnapshot(snapId);
                    }
                };
                mainHandler.postDelayed(settleTask, 650);
            }
        });
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

    private void extractSnapshot(final int snapId) {
        if (activeId != snapId) return;
        activeId = 0;
        cancelPendingCallbacks();

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
            // Reset offscreen WebView so background scripts/timers don't keep running
            webView.stopLoading();
            webView.loadUrl("about:blank");
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
            webView.stopLoading();
            webView.destroy();
        } catch (Exception ignored) {
        }
    }
}

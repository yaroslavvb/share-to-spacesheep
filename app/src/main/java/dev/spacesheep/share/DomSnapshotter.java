package dev.spacesheep.share;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Offscreen WebView that renders shared pages to capture post-JS DOM state and <canvas> bitmaps,
 * while rejecting Chromium error pages and cleaning up to avoid background resource leaks.
 */
public final class DomSnapshotter {
    public interface SnapshotCallback {
        void onSnapshotReady(JSONObject result);
        void onAssetReady(JSONObject result);
    }

    private final WebView webView;
    private final Handler mainHandler;
    private final SnapshotCallback callback;
    private final String userAgent;
    private final String webglHookJs;
    private final String checkReadyJs;
    private final String serializeJs;
    private final String fetchAssetJs;

    private int activeId = 0;
    private Runnable timeoutTask = null;
    private Runnable settleTask = null;

    @SuppressLint("SetJavaScriptEnabled")
    public DomSnapshotter(Context context, Handler mainHandler, SnapshotCallback callback) {
        this.mainHandler = mainHandler;
        this.callback = callback;
        this.webglHookJs = loadAssetScript(context, "dom/webgl-hook.js");
        this.checkReadyJs = loadAssetScript(context, "dom/check-ready.js");
        this.serializeJs = loadAssetScript(context, "dom/serialize.js");
        this.fetchAssetJs = loadAssetScript(context, "dom/fetch-asset.js");

        this.webView = new WebView(context) {
            @Override
            protected void onWindowVisibilityChanged(int visibility) {
                super.onWindowVisibilityChanged(android.view.View.VISIBLE);
            }
        };
        this.webView.setAlpha(0.01f);
        this.webView.setSoundEffectsEnabled(false);

        try {
            android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
            cm.setAcceptCookie(true);
            cm.setAcceptThirdPartyCookies(this.webView, true);
        } catch (Exception ignored) {
        }

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
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, android.webkit.WebResourceRequest request) {
                try {
                    String path = request.getUrl() != null ? request.getUrl().getPath() : null;
                    if (path != null && path.matches("(?i).*\\.(mp4|webm|ogv|mov|m4v|mp3|wav|ogg|flac|m4a|woff2?|ttf|otf|eot)$")) {
                        return new android.webkit.WebResourceResponse(
                                "text/plain",
                                "utf-8",
                                new java.io.ByteArrayInputStream(new byte[0])
                        );
                    }
                } catch (Exception ignored) {
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (activeId > 0 && !"about:blank".equals(url)) {
                    view.evaluateJavascript(webglHookJs, null);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                final int snapId = activeId;
                if (snapId <= 0 || "about:blank".equals(url)) return;
                scheduleCheckOrExtract(snapId, 120);
            }
        });
    }

    private static String loadAssetScript(Context context, String assetPath) {
        try (InputStream is = context.getAssets().open(assetPath)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
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
                    checkReadyJs,
                    val -> {
                        if (activeId != snapId) return;
                        if ("\"challenge\"".equals(val)) {
                            scheduleCheckOrExtract(snapId, 600);
                        } else if ("\"wait\"".equals(val)) {
                            scheduleCheckOrExtract(snapId, 160);
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
            mainHandler.postDelayed(timeoutTask, Math.max(1200, timeoutMs));
            webView.stopLoading();
            webView.loadUrl(url);
            scheduleCheckOrExtract(id, 280);
        });
    }

    public void fetchAsset(final int id, final String url, final long maxBytes) {
        mainHandler.post(() -> {
            String js = fetchAssetJs.trim() + "(" + JSONObject.quote(url) + ", " + maxBytes + ")"
                    + ".then(function(j) { window.AndroidSnapshotBridge.onAssetFetched(" + id + ", j); });";
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

        webView.evaluateJavascript(serializeJs, value -> {
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

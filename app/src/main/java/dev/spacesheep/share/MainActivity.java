package dev.spacesheep.share;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.GZIPInputStream;

public class MainActivity extends Activity {
    private static final String TAG = "SpacesheepShare";
    private static final String ASSET_HOST = "appassets.spacesheep.invalid";
    private static final String PREFS_NAME = "spacesheep_local_storage";
    private static final String PREFS_KEY_JSON = "storage_root";
    private static final int REQ_PICK_FILES = 1001;
    private static final String USER_AGENT =
            "Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36";

    private WebView mainWebView;
    private WebView renderWebView;
    private boolean mainPageLoaded = false;
    private JSONObject pendingPayload = null;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService httpPool = Executors.newFixedThreadPool(8);
    private final AtomicInteger nextFileId = new AtomicInteger(1);
    private final Map<String, Uri> sharedFileUris = new ConcurrentHashMap<>();
    private final Map<Integer, ServerSocket> oauthSockets = new ConcurrentHashMap<>();
    private final AtomicInteger nextOAuthId = new AtomicInteger(1);

    private int activeSnapshotId = 0;
    private Runnable activeSnapshotTimeout = null;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        if (android.os.Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        // Offscreen WebView for rendering live DOM snapshots of shared web pages
        renderWebView = new WebView(this);
        renderWebView.setVisibility(View.INVISIBLE);
        configureWebViewSettings(renderWebView.getSettings());
        renderWebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                final int snapId = activeSnapshotId;
                if (snapId <= 0) return;
                mainHandler.postDelayed(() -> {
                    if (activeSnapshotId == snapId) {
                        extractDomSnapshot(snapId, url);
                    }
                }, 650);
            }
        });
        root.addView(renderWebView, new FrameLayout.LayoutParams(1280, 900));

        // Main UI WebView
        mainWebView = new WebView(this);
        configureWebViewSettings(mainWebView.getSettings());
        mainWebView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        mainWebView.setWebChromeClient(new WebChromeClient());
        mainWebView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && ASSET_HOST.equalsIgnoreCase(uri.getHost())) {
                    return handleAppAssetRequest(uri);
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                mainPageLoaded = true;
            }
        });

        root.addView(mainWebView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);

        pendingPayload = buildPayloadFromIntent(getIntent());
        mainWebView.loadUrl("https://" + ASSET_HOST + "/index.html");
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebViewSettings(WebSettings settings) {
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setUserAgentString(USER_AGENT);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction())) {
            Uri data = intent.getData();
            if (data != null && "spacesheep-share".equals(data.getScheme())) {
                // Returning from browser OAuth flow; keep current UI state
                return;
            }
        }
        JSONObject payload = buildPayloadFromIntent(intent);
        pendingPayload = payload;
        if (mainPageLoaded && mainWebView != null) {
            final String js = "window.__handleIncomingShare && window.__handleIncomingShare(" + payload.toString() + ");";
            mainHandler.post(() -> mainWebView.evaluateJavascript(js, null));
        }
    }

    private JSONObject buildPayloadFromIntent(Intent intent) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("mode", "launcher");
            if (intent == null) return payload;

            // Optional CLI/adb configuration extras
            String cfgKey = intent.getStringExtra("configure_key");
            String cfgHandle = intent.getStringExtra("configure_handle");
            if (cfgKey != null && !cfgKey.trim().isEmpty()) {
                payload.put("configureKey", cfgKey.trim());
                if (cfgHandle != null && !cfgHandle.trim().isEmpty()) {
                    payload.put("configureHandle", cfgHandle.trim());
                }
                saveKeyDirectlyToStorage(cfgKey.trim(), cfgHandle);
            }

            String spaceUuid = intent.getStringExtra("space_uuid");
            if (spaceUuid == null || spaceUuid.trim().isEmpty()) {
                spaceUuid = intent.getStringExtra("dev.spacesheep.share.EXTRA_SPACE_ID");
            }
            if (spaceUuid != null && !spaceUuid.trim().isEmpty()) {
                payload.put("spaceUuid", spaceUuid.trim());
            }
            String visibility = intent.getStringExtra("visibility");
            if (visibility == null || visibility.trim().isEmpty()) {
                visibility = intent.getStringExtra("dev.spacesheep.share.EXTRA_VISIBILITY");
            }
            if (visibility != null && !visibility.trim().isEmpty()) {
                payload.put("visibility", visibility.trim());
            }

            String directUrl = intent.getStringExtra("share_url");
            if (directUrl != null && !directUrl.trim().isEmpty()) {
                payload.put("mode", "url");
                payload.put("url", directUrl.trim());
                payload.put("title", intent.getStringExtra("share_title") != null ? intent.getStringExtra("share_title") : "");
                payload.put("autoPublish", true);
                return payload;
            }

            String action = intent.getAction();
            String type = intent.getType();
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (subject == null) subject = intent.getStringExtra(Intent.EXTRA_TITLE);
            payload.put("title", subject != null ? subject.trim() : "");
            payload.put("autoPublish", true);

            if (Intent.ACTION_SEND.equals(action)) {
                Uri streamUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                String extraText = intent.getStringExtra(Intent.EXTRA_TEXT);

                if (streamUri == null && extraText != null && !extraText.trim().isEmpty()) {
                    String trimmed = extraText.trim();
                    if (trimmed.matches("(?i)^https?://\\S+$")) {
                        payload.put("mode", "url");
                        payload.put("url", trimmed);
                    } else {
                        payload.put("mode", "text");
                        payload.put("text", trimmed);
                    }
                    return payload;
                }

                if (streamUri != null) {
                    // Check if text/plain also carries a pure URL from Chrome
                    if ("text/plain".equalsIgnoreCase(type) && extraText != null && extraText.trim().matches("(?i)^https?://\\S+$")) {
                        payload.put("mode", "url");
                        payload.put("url", extraText.trim());
                        return payload;
                    }
                    JSONArray arr = new JSONArray();
                    arr.put(registerSharedUri(streamUri));
                    payload.put("mode", "files");
                    payload.put("files", arr);
                    return payload;
                }
            } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (uris != null && !uris.isEmpty()) {
                    JSONArray arr = new JSONArray();
                    for (Uri u : uris) {
                        if (u != null) arr.put(registerSharedUri(u));
                    }
                    payload.put("mode", "files");
                    payload.put("files", arr);
                    return payload;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error building payload from intent", e);
        }
        return payload;
    }

    private void saveKeyDirectlyToStorage(String key, String handle) {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            JSONObject root = new JSONObject(prefs.getString(PREFS_KEY_JSON, "{}"));
            JSONObject auth = new JSONObject();
            auth.put("kind", "key");
            auth.put("key", key);
            root.put("auth", auth);
            if (handle != null && !handle.trim().isEmpty()) {
                JSONObject acct = new JSONObject();
                acct.put("handle", handle.trim().replaceFirst("^@", ""));
                root.put("account", acct);
            }
            prefs.edit().putString(PREFS_KEY_JSON, root.toString()).apply();
        } catch (Exception e) {
            Log.e(TAG, "Failed saving key to storage", e);
        }
    }

    private JSONObject registerSharedUri(Uri uri) throws Exception {
        String id = String.valueOf(nextFileId.getAndIncrement());
        sharedFileUris.put(id, uri);
        String name = "file";
        long size = 0;
        String mime = getContentResolver().getType(uri);
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameIdx >= 0 && !cursor.isNull(nameIdx)) {
                    name = cursor.getString(nameIdx);
                }
                if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                    size = cursor.getLong(sizeIdx);
                }
            }
        } catch (Exception ignored) {
        }
        if ("file".equals(name) && uri.getLastPathSegment() != null) {
            name = uri.getLastPathSegment();
        }
        JSONObject obj = new JSONObject();
        obj.put("id", id);
        obj.put("name", name);
        obj.put("type", mime != null ? mime : "");
        obj.put("size", size);
        return obj;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_PICK_FILES) {
            JSONArray picked = new JSONArray();
            if (resultCode == RESULT_OK && data != null) {
                try {
                    ClipData clip = data.getClipData();
                    if (clip != null) {
                        for (int i = 0; i < clip.getItemCount(); i++) {
                            Uri u = clip.getItemAt(i).getUri();
                            if (u != null) picked.put(registerSharedUri(u));
                        }
                    } else if (data.getData() != null) {
                        picked.put(registerSharedUri(data.getData()));
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Error reading picked files", e);
                }
            }
            final String js = "window.__onFilesPicked && window.__onFilesPicked(" + picked.toString() + ");";
            mainHandler.post(() -> mainWebView.evaluateJavascript(js, null));
        }
    }

    private WebResourceResponse handleAppAssetRequest(Uri uri) {
        String path = uri.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) {
            path = "/index.html";
        }
        if ("/__fetch".equals(path)) {
            return handleProxyFetch(uri);
        }
        if ("/__shared_file".equals(path)) {
            return handleSharedFileStream(uri);
        }

        String assetPath = path.replaceFirst("^/+", "");
        try {
            InputStream is = getAssets().open(assetPath);
            String mime = guessMimeType(assetPath);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-cache");
            return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, is);
        } catch (Exception e) {
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", headers,
                    new ByteArrayInputStream("Not found".getBytes(StandardCharsets.UTF_8)));
        }
    }

    private WebResourceResponse handleSharedFileStream(Uri uri) {
        String id = uri.getQueryParameter("id");
        Uri fileUri = id != null ? sharedFileUris.get(id) : null;
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        if (fileUri == null) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", headers,
                    new ByteArrayInputStream(new byte[0]));
        }
        try {
            InputStream is = getContentResolver().openInputStream(fileUri);
            String mime = getContentResolver().getType(fileUri);
            if (mime == null || mime.isEmpty()) mime = "application/octet-stream";
            return new WebResourceResponse(mime, null, 200, "OK", headers, is);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "UTF-8", 500, "Error", headers,
                    new ByteArrayInputStream(new byte[0]));
        }
    }

    private WebResourceResponse handleProxyFetch(Uri uri) {
        String targetUrl = uri.getQueryParameter("url");
        long maxBytes = 25L * 1024L * 1024L;
        try {
            String maxParam = uri.getQueryParameter("maxBytes");
            if (maxParam != null) maxBytes = Long.parseLong(maxParam);
        } catch (Exception ignored) {
        }

        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Access-Control-Expose-Headers", "X-Final-Url, X-Orig-Type, X-Fetch-Error, X-Http-Status");

        if (targetUrl == null || targetUrl.isEmpty()) {
            headers.put("X-Fetch-Error", "missing_url");
            return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers,
                    new ByteArrayInputStream(new byte[0]));
        }

        HttpURLConnection conn = null;
        try {
            String currentUrl = targetUrl;
            for (int redirects = 0; redirects < 8; redirects++) {
                URL u = new URL(currentUrl);
                conn = (HttpURLConnection) u.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(20000);
                conn.setRequestMethod("GET");
                conn.setRequestProperty("User-Agent", USER_AGENT);
                conn.setRequestProperty("Accept", "*/*");
                conn.setRequestProperty("Accept-Encoding", "gzip, identity");
                String cookie = CookieManager.getInstance().getCookie(currentUrl);
                if (cookie != null && !cookie.isEmpty()) {
                    conn.setRequestProperty("Cookie", cookie);
                }

                int status = conn.getResponseCode();
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String loc = conn.getHeaderField("Location");
                    conn.disconnect();
                    if (loc == null) break;
                    currentUrl = new URL(u, loc).toString();
                    continue;
                }

                headers.put("X-Final-Url", conn.getURL().toString());
                headers.put("X-Http-Status", String.valueOf(status));
                String ctype = conn.getContentType();
                if (ctype != null) headers.put("X-Orig-Type", ctype);

                long contentLength = conn.getContentLengthLong();
                if (contentLength > maxBytes) {
                    headers.put("X-Fetch-Error", "too_big");
                    conn.disconnect();
                    return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers,
                            new ByteArrayInputStream(new byte[0]));
                }

                InputStream rawStream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (rawStream == null) {
                    conn.disconnect();
                    return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers,
                            new ByteArrayInputStream(new byte[0]));
                }
                String encoding = conn.getContentEncoding();
                if (encoding != null && encoding.toLowerCase().contains("gzip")) {
                    rawStream = new GZIPInputStream(rawStream);
                }

                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                long total = 0;
                int r;
                while ((r = rawStream.read(buf)) != -1) {
                    total += r;
                    if (total > maxBytes) {
                        rawStream.close();
                        conn.disconnect();
                        headers.put("X-Fetch-Error", "too_big");
                        return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers,
                                new ByteArrayInputStream(new byte[0]));
                    }
                    bos.write(buf, 0, r);
                }
                rawStream.close();
                conn.disconnect();

                String cleanMime = ctype != null ? ctype.split(";")[0].trim() : "application/octet-stream";
                return new WebResourceResponse(cleanMime, null, 200, "OK", headers,
                        new ByteArrayInputStream(bos.toByteArray()));
            }
            headers.put("X-Fetch-Error", "too_many_redirects");
        } catch (Exception e) {
            headers.put("X-Fetch-Error", e.getMessage() != null ? e.getMessage() : "network_error");
            if (conn != null) conn.disconnect();
        }
        return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers,
                new ByteArrayInputStream(new byte[0]));
    }

    private void extractDomSnapshot(final int snapId, final String loadedUrl) {
        if (activeSnapshotId != snapId) return;
        activeSnapshotId = 0;
        if (activeSnapshotTimeout != null) {
            mainHandler.removeCallbacks(activeSnapshotTimeout);
            activeSnapshotTimeout = null;
        }
        String snapshotScript = "(function(){" +
                "try {" +
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
                "  return JSON.stringify({ ok: true, html: dt + '\\n' + root.outerHTML, title: document.title || '', finalUrl: location.href });" +
                "} catch(err) { return JSON.stringify({ ok: false, error: String(err) }); }" +
                "})()";

        renderWebView.evaluateJavascript(snapshotScript, value -> {
            try {
                // evaluateJavascript returns a JSON-encoded string literal
                Object parsed = new org.json.JSONTokener(value).nextValue();
                JSONObject res = parsed instanceof String ? new JSONObject((String) parsed) : new JSONObject();
                res.put("id", snapId);
                sendSnapshotResult(res);
            } catch (Exception e) {
                try {
                    JSONObject err = new JSONObject();
                    err.put("id", snapId);
                    err.put("ok", false);
                    sendSnapshotResult(err);
                } catch (Exception ignored) {
                }
            }
        });
    }

    private void sendSnapshotResult(final JSONObject res) {
        mainHandler.post(() -> {
            if (mainWebView != null) {
                mainWebView.evaluateJavascript(
                        "window.__onSnapshotResponse && window.__onSnapshotResponse(" + res.toString() + ");",
                        null);
            }
        });
    }

    private String guessMimeType(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".wasm")) return "application/wasm";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    private class AndroidBridge {
        @JavascriptInterface
        public String getInitialPayload() {
            return pendingPayload != null ? pendingPayload.toString() : "{\"mode\":\"launcher\"}";
        }

        @JavascriptInterface
        public String storageGetAll() {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            return prefs.getString(PREFS_KEY_JSON, "{}");
        }

        @JavascriptInterface
        public synchronized void storageSet(String patchJson) {
            try {
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                JSONObject root = new JSONObject(prefs.getString(PREFS_KEY_JSON, "{}"));
                JSONObject patch = new JSONObject(patchJson);
                Iterator<String> keys = patch.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    root.put(k, patch.get(k));
                }
                prefs.edit().putString(PREFS_KEY_JSON, root.toString()).apply();
            } catch (Exception e) {
                Log.e(TAG, "storageSet failed", e);
            }
        }

        @JavascriptInterface
        public synchronized void storageRemove(String keysJson) {
            try {
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                JSONObject root = new JSONObject(prefs.getString(PREFS_KEY_JSON, "{}"));
                JSONArray arr = new JSONArray(keysJson);
                for (int i = 0; i < arr.length(); i++) {
                    root.remove(arr.getString(i));
                }
                prefs.edit().putString(PREFS_KEY_JSON, root.toString()).apply();
            } catch (Exception e) {
                Log.e(TAG, "storageRemove failed", e);
            }
        }

        @JavascriptInterface
        public void httpRequestAsync(
                final int id,
                final String urlStr,
                final String method,
                final String headersJson,
                final String bodyStr,
                final boolean isBase64) {
            httpPool.execute(() -> {
                JSONObject responseObj = new JSONObject();
                HttpURLConnection conn = null;
                try {
                    responseObj.put("id", id);
                    URL url = new URL(urlStr);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(45000);
                    conn.setRequestMethod(method != null ? method : "GET");
                    conn.setRequestProperty("User-Agent", USER_AGENT);

                    if (headersJson != null && !headersJson.isEmpty()) {
                        JSONObject hdrs = new JSONObject(headersJson);
                        Iterator<String> it = hdrs.keys();
                        while (it.hasNext()) {
                            String k = it.next();
                            conn.setRequestProperty(k, hdrs.optString(k, ""));
                        }
                    }

                    if (bodyStr != null && !bodyStr.isEmpty() && !"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
                        conn.setDoOutput(true);
                        byte[] outBytes = isBase64
                                ? Base64.decode(bodyStr, Base64.DEFAULT)
                                : bodyStr.getBytes(StandardCharsets.UTF_8);
                        conn.setFixedLengthStreamingMode(outBytes.length);
                        try (OutputStream os = conn.getOutputStream()) {
                            os.write(outBytes);
                        }
                    }

                    int status = conn.getResponseCode();
                    responseObj.put("status", status);
                    responseObj.put("finalUrl", conn.getURL().toString());

                    JSONObject respHeaders = new JSONObject();
                    Map<String, List<String>> map = conn.getHeaderFields();
                    if (map != null) {
                        for (Map.Entry<String, List<String>> entry : map.entrySet()) {
                            if (entry.getKey() != null && entry.getValue() != null && !entry.getValue().isEmpty()) {
                                respHeaders.put(entry.getKey().toLowerCase(), entry.getValue().get(0));
                            }
                        }
                    }
                    responseObj.put("headers", respHeaders);

                    InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                    String respText = "";
                    if (is != null) {
                        String encoding = conn.getContentEncoding();
                        if (encoding != null && encoding.toLowerCase().contains("gzip")) {
                            is = new GZIPInputStream(is);
                        }
                        ByteArrayOutputStream bos = new ByteArrayOutputStream();
                        byte[] buf = new byte[8192];
                        int r;
                        while ((r = is.read(buf)) != -1) {
                            bos.write(buf, 0, r);
                        }
                        is.close();
                        respText = new String(bos.toByteArray(), StandardCharsets.UTF_8);
                    }
                    responseObj.put("body", respText);
                } catch (Exception e) {
                    try {
                        responseObj.put("id", id);
                        responseObj.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                    } catch (Exception ignored) {
                    }
                } finally {
                    if (conn != null) conn.disconnect();
                }

                final String js = "window.__onHttpResponse && window.__onHttpResponse(" + responseObj.toString() + ");";
                mainHandler.post(() -> {
                    if (mainWebView != null) mainWebView.evaluateJavascript(js, null);
                });
            });
        }

        @JavascriptInterface
        public void renderPageSnapshot(final int id, final String url, final int timeoutMs) {
            mainHandler.post(() -> {
                activeSnapshotId = id;
                if (activeSnapshotTimeout != null) {
                    mainHandler.removeCallbacks(activeSnapshotTimeout);
                }
                activeSnapshotTimeout = () -> {
                    if (activeSnapshotId == id) {
                        extractDomSnapshot(id, url);
                    }
                };
                mainHandler.postDelayed(activeSnapshotTimeout, Math.max(1500, timeoutMs));
                renderWebView.stopLoading();
                renderWebView.loadUrl(url);
            });
        }

        @JavascriptInterface
        public String prepareOAuthLoopback() {
            try {
                int id = nextOAuthId.getAndIncrement();
                ServerSocket serverSocket = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
                int port = serverSocket.getLocalPort();
                oauthSockets.put(id, serverSocket);
                JSONObject obj = new JSONObject();
                obj.put("id", id);
                obj.put("redirectUri", "http://127.0.0.1:" + port + "/oauth");
                return obj.toString();
            } catch (Exception e) {
                Log.e(TAG, "Failed to bind OAuth loopback socket", e);
                return "{}";
            }
        }

        @JavascriptInterface
        public void launchOAuthLoopback(final int id, final String authorizeUrl) {
            final ServerSocket serverSocket = oauthSockets.get(id);
            if (serverSocket == null) return;

            httpPool.execute(() -> {
                JSONObject res = new JSONObject();
                try {
                    res.put("id", id);
                    serverSocket.setSoTimeout(300000);
                    try (Socket client = serverSocket.accept()) {
                        BufferedReader reader = new BufferedReader(
                                new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
                        String requestLine = reader.readLine();
                        String path = "/oauth";
                        if (requestLine != null && requestLine.startsWith("GET ")) {
                            String[] parts = requestLine.split(" ");
                            if (parts.length >= 2) path = parts[1];
                        }
                        String fullCallback = "http://127.0.0.1:" + serverSocket.getLocalPort() + path;
                        String html = "<!doctype html><html><head><meta charset='utf-8'>" +
                                "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
                                "<title>Connected to spacesheep</title></head>" +
                                "<body style='font:16px system-ui;padding:32px;text-align:center'>" +
                                "<h2>Connected to Spacesheep</h2><p>Returning to Spacesheep…</p>" +
                                "<script>location.replace('intent://oauth#Intent;scheme=spacesheep-share;package=dev.spacesheep.share;end');</script>" +
                                "</body></html>";
                        byte[] bodyBytes = html.getBytes(StandardCharsets.UTF_8);
                        String httpResp = "HTTP/1.1 200 OK\r\n" +
                                "Content-Type: text/html; charset=utf-8\r\n" +
                                "Content-Length: " + bodyBytes.length + "\r\n" +
                                "Connection: close\r\n\r\n";
                        OutputStream os = client.getOutputStream();
                        os.write(httpResp.getBytes(StandardCharsets.UTF_8));
                        os.write(bodyBytes);
                        os.flush();
                        res.put("url", fullCallback);
                    }
                } catch (Exception e) {
                    try {
                        res.put("id", id);
                        res.put("error", e.getMessage() != null ? e.getMessage() : "OAuth sign-in cancelled");
                    } catch (Exception ignored) {
                    }
                } finally {
                    oauthSockets.remove(id);
                    try {
                        serverSocket.close();
                    } catch (Exception ignored) {
                    }
                }
                final String js = "window.__onOAuthCallback && window.__onOAuthCallback(" + res.toString() + ");";
                mainHandler.post(() -> {
                    if (mainWebView != null) mainWebView.evaluateJavascript(js, null);
                });
            });

            openExternalUrl(authorizeUrl);
        }

        @JavascriptInterface
        public void pickFiles() {
            mainHandler.post(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                startActivityForResult(intent, REQ_PICK_FILES);
            });
        }

        @JavascriptInterface
        public void openExternalUrl(final String url) {
            if (url == null || url.isEmpty()) return;
            mainHandler.post(() -> {
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    Log.e(TAG, "Failed to open external URL: " + url, e);
                }
            });
        }

        @JavascriptInterface
        public void copyToClipboard(final String text) {
            mainHandler.post(() -> {
                try {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) {
                        cm.setPrimaryClip(ClipData.newPlainText("spacesheep link", text));
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Clipboard copy failed", e);
                }
            });
        }

        @JavascriptInterface
        public void reportStatus(final String statusJson) {
            Log.i(TAG, statusJson);
            try {
                File out = new File(getFilesDir(), "last_status.json");
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    fos.write(statusJson.getBytes(StandardCharsets.UTF_8));
                }
            } catch (Exception ignored) {
            }
        }
    }
}

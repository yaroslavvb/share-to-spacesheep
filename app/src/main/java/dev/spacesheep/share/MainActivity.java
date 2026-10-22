package dev.spacesheep.share;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Log;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
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

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

public class MainActivity extends Activity {
    private static final String TAG = "SpacesheepShare";
    private static final String ASSET_HOST = "appassets.spacesheep.invalid";
    private static final int REQ_PICK_FILES = 1001;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicInteger nextFileId = new AtomicInteger(1);
    private final Map<String, Uri> sharedFileUris = new ConcurrentHashMap<>();

    private SpacesheepStorage storage;
    private NativeHttpClient httpClient;
    private OAuthLoopbackServer oauthServer;
    private DomSnapshotter snapshotter;

    private WebView mainWebView;
    private boolean mainPageLoaded = false;
    private JSONObject pendingPayload = null;
    private static volatile JSONObject lastValidSharePayload = null;
    private static volatile long lastValidShareTimeMs = 0L;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        storage = new SpacesheepStorage(this);
        snapshotter = new DomSnapshotter(this, mainHandler, new DomSnapshotter.SnapshotCallback() {
            @Override
            public void onSnapshotReady(JSONObject res) {
                evalJs("window.__onSnapshotResponse && window.__onSnapshotResponse(" + res.toString() + ");");
            }

            @Override
            public void onAssetReady(JSONObject res) {
                evalJs("window.__onSnapshotAssetResponse && window.__onSnapshotAssetResponse(" + res.toString() + ");");
            }
        });
        httpClient = new NativeHttpClient(snapshotter.getUserAgent());
        oauthServer = new OAuthLoopbackServer(httpClient.getExecutor(), new OAuthLoopbackServer.CallbackListener() {
            @Override
            public void onOAuthResult(JSONObject result) {
                stopOAuthKeepAliveService();
                evalJs("window.__onOAuthCallback && window.__onOAuthCallback(" + result.toString() + ");");
            }

            @Override
            public void onBringToForeground() {
                mainHandler.post(() -> {
                    try {
                        Intent bringFront = new Intent(MainActivity.this, MainActivity.class);
                        bringFront.putExtra("oauth_return", true);
                        bringFront.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                        startActivity(bringFront);
                    } catch (Exception ignored) {
                    }
                });
            }
        });

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFFFAF8F5);
        root.setFitsSystemWindows(true);
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(
                        android.view.WindowInsets.Type.systemBars()
                                | android.view.WindowInsets.Type.displayCutout()
                                | android.view.WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return android.view.WindowInsets.CONSUMED;
            });
        }
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        root.addView(snapshotter.getWebView(), new FrameLayout.LayoutParams(1280, 900));

        mainWebView = new WebView(this) {
            @Override
            protected void onWindowVisibilityChanged(int visibility) {
                super.onWindowVisibilityChanged(android.view.View.VISIBLE);
            }
        };
        configureMainWebView(mainWebView.getSettings());
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
    private void configureMainWebView(WebSettings settings) {
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setUserAgentString(httpClient.getUserAgent());
    }

    private void evalJs(final String script) {
        mainHandler.post(() -> {
            if (mainWebView != null) {
                mainWebView.evaluateJavascript(script, null);
            }
        });
    }

    private void startOAuthKeepAliveService() {
        mainHandler.post(() -> {
            try {
                Intent svc = new Intent(MainActivity.this, OAuthKeepAliveService.class);
                if (Build.VERSION.SDK_INT >= 26) {
                    startForegroundService(svc);
                } else {
                    startService(svc);
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not start OAuthKeepAliveService", e);
            }
        });
    }

    private void stopOAuthKeepAliveService() {
        mainHandler.post(() -> {
            try {
                stopService(new Intent(MainActivity.this, OAuthKeepAliveService.class));
            } catch (Exception ignored) {
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && intent.getBooleanExtra("oauth_return", false)) {
            return;
        }
        if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction())) {
            Uri data = intent.getData();
            if (data != null && "spacesheep-share".equals(data.getScheme())) {
                return;
            }
        }
        if (intent != null && Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri streamUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            String extraText = firstNonEmpty(intent.getStringExtra(Intent.EXTRA_TEXT), intent.getStringExtra("share_url"));
            if (streamUri == null && extraText == null) {
                return;
            }
        }
        setIntent(intent);
        JSONObject payload = buildPayloadFromIntent(intent);
        pendingPayload = payload;
        if (mainPageLoaded) {
            evalJs("window.__handleIncomingShare && window.__handleIncomingShare(" + payload.toString() + ");");
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopOAuthKeepAliveService();
        if (oauthServer != null) oauthServer.shutdown();
        if (snapshotter != null) snapshotter.destroy();
        if (mainWebView != null) {
            try {
                if (mainWebView.getParent() instanceof ViewGroup) {
                    ((ViewGroup) mainWebView.getParent()).removeView(mainWebView);
                }
                mainWebView.stopLoading();
                mainWebView.destroy();
            } catch (Exception ignored) {
            }
            mainWebView = null;
        }
        if (httpClient != null) httpClient.shutdown();
    }

    private static JSONObject rememberValidPayload(JSONObject p) {
        lastValidSharePayload = p;
        lastValidShareTimeMs = System.currentTimeMillis();
        return p;
    }

    private JSONObject buildPayloadFromIntent(Intent intent) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("mode", "launcher");
            if (intent == null) return payload;

            String cfgKey = intent.getStringExtra("configure_key");
            String cfgHandle = intent.getStringExtra("configure_handle");
            if (cfgKey != null && !cfgKey.trim().isEmpty()) {
                payload.put("configureKey", cfgKey.trim());
                if (cfgHandle != null && !cfgHandle.trim().isEmpty()) {
                    payload.put("configureHandle", cfgHandle.trim());
                }
                storage.saveKeyDirectly(cfgKey.trim(), cfgHandle);
            }

            String spaceUuid = firstNonEmpty(
                    intent.getStringExtra("space_uuid"),
                    intent.getStringExtra("dev.spacesheep.share.EXTRA_SPACE_ID"));
            if (spaceUuid != null) {
                payload.put("spaceUuid", spaceUuid);
            }

            String visibility = firstNonEmpty(
                    intent.getStringExtra("visibility"),
                    intent.getStringExtra("dev.spacesheep.share.EXTRA_VISIBILITY"));
            if (visibility != null) {
                payload.put("visibility", visibility);
            }

            String directUrl = firstNonEmpty(intent.getStringExtra("share_url"));
            if (directUrl != null) {
                payload.put("mode", "url");
                payload.put("url", directUrl);
                payload.put("title", intent.getStringExtra("share_title") != null ? intent.getStringExtra("share_title") : "");
                payload.put("autoPublish", true);
                return rememberValidPayload(payload);
            }

            String action = intent.getAction();
            String type = intent.getType();
            String subject = firstNonEmpty(
                    intent.getStringExtra(Intent.EXTRA_SUBJECT),
                    intent.getStringExtra(Intent.EXTRA_TITLE));
            payload.put("title", subject != null ? subject : "");
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
                    return rememberValidPayload(payload);
                }

                if (streamUri != null) {
                    if ("text/plain".equalsIgnoreCase(type) && extraText != null && extraText.trim().matches("(?i)^https?://\\S+$")) {
                        payload.put("mode", "url");
                        payload.put("url", extraText.trim());
                        return rememberValidPayload(payload);
                    }
                    JSONArray arr = new JSONArray();
                    arr.put(registerSharedUri(streamUri));
                    payload.put("mode", "files");
                    payload.put("files", arr);
                    return rememberValidPayload(payload);
                }

                if (lastValidSharePayload != null && (System.currentTimeMillis() - lastValidShareTimeMs) < 15000L) {
                    return lastValidSharePayload;
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
                    return rememberValidPayload(payload);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error building payload from intent", e);
        }
        return payload;
    }

    private static String firstNonEmpty(String... candidates) {
        if (candidates == null) return null;
        for (String c : candidates) {
            if (c != null && !c.trim().isEmpty()) return c.trim();
        }
        return null;
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
            evalJs("window.__onFilesPicked && window.__onFilesPicked(" + picked.toString() + ");");
        }
    }

    private WebResourceResponse handleAppAssetRequest(Uri uri) {
        String path = uri.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) {
            path = "/index.html";
        }
        if ("/__fetch".equals(path)) {
            return httpClient.handleProxyFetch(uri);
        }
        if ("/__blob".equals(path)) {
            return httpClient.handleBlobFetch(uri);
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

    private static String guessMimeType(String path) {
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
            return storage.getAllJson();
        }

        @JavascriptInterface
        public void storageSet(String patchJson) {
            storage.setPatchJson(patchJson);
        }

        @JavascriptInterface
        public void storageRemove(String keysJson) {
            storage.removeKeysJson(keysJson);
        }

        @JavascriptInterface
        public void httpRequestAsync(
                final int id,
                final String urlStr,
                final String method,
                final String headersJson,
                final String bodyStr,
                final boolean isBase64) {
            httpClient.executeAsync(id, urlStr, method, headersJson, bodyStr, isBase64,
                    res -> evalJs("window.__onHttpResponse && window.__onHttpResponse(" + res.toString() + ");"));
        }

        @JavascriptInterface
        public void fetchBinaryAsync(
                final int id,
                final String urlStr,
                final long maxBytes) {
            httpClient.fetchBinaryAsync(id, urlStr, maxBytes,
                    res -> evalJs("window.__onBinaryResponse && window.__onBinaryResponse(" + res.toString() + ");"));
        }

        @JavascriptInterface
        public void renderPageSnapshot(final int id, final String url, final int timeoutMs) {
            snapshotter.startSnapshot(id, url, timeoutMs);
        }

        @JavascriptInterface
        public void fetchSnapshotAsset(final int id, final String url, final long maxBytes) {
            snapshotter.fetchAsset(id, url, maxBytes);
        }

        @JavascriptInterface
        public void resetPageSnapshot() {
            snapshotter.resetToBlank();
        }

        @JavascriptInterface
        public String prepareOAuthLoopback() {
            return oauthServer.prepareLoopbackJson();
        }

        @JavascriptInterface
        public void launchOAuthLoopback(final int id, final String authorizeUrl) {
            startOAuthKeepAliveService();
            oauthServer.listenForCallback(id);
            if (authorizeUrl == null || authorizeUrl.isEmpty()) return;
            mainHandler.post(() -> {
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(authorizeUrl));
                    Bundle extras = new Bundle();
                    extras.putBinder("android.support.customtabs.extra.SESSION", null);
                    extras.putInt("android.support.customtabs.extra.TOOLBAR_COLOR", 0xFF141210);
                    extras.putInt("android.support.customtabs.extra.TITLE_VISIBILITY", 1);
                    i.putExtras(extras);
                    startActivity(i);
                } catch (Exception e) {
                    Log.e(TAG, "Failed to open OAuth Custom Tab, falling back", e);
                    openExternalUrl(authorizeUrl);
                }
            });
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

package dev.spacesheep.share;

import android.net.Uri;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.WebResourceResponse;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.GZIPInputStream;
import java.util.zip.InflaterInputStream;

/**
 * Native HTTP client bypassing WebView CORS restrictions for MCP JSON-RPC calls
 * and cross-origin webpage/asset fetching.
 */
public final class NativeHttpClient {
    public static final String DEFAULT_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36";

    public interface ResponseCallback {
        void onComplete(JSONObject responseObj);
    }

    private final ExecutorService httpPool = Executors.newFixedThreadPool(24);
    private final ConcurrentHashMap<Integer, byte[]> blobStore = new ConcurrentHashMap<>();
    private final String userAgent;

    public NativeHttpClient(String userAgent) {
        this.userAgent = (userAgent != null && !userAgent.isEmpty()) ? userAgent : DEFAULT_USER_AGENT;
    }

    public String getUserAgent() {
        return userAgent;
    }

    public ExecutorService getExecutor() {
        return httpPool;
    }

    public void executeAsync(
            final int id,
            final String urlStr,
            final String method,
            final String headersJson,
            final String bodyStr,
            final boolean isBase64,
            final ResponseCallback callback) {
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
                conn.setRequestProperty("User-Agent", userAgent);
                conn.setRequestProperty("Accept-Encoding", "gzip, deflate, identity");

                if (headersJson != null && !headersJson.isEmpty()) {
                    JSONObject hdrs = new JSONObject(headersJson);
                    Iterator<String> it = hdrs.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        conn.setRequestProperty(k, hdrs.optString(k, ""));
                    }
                }

                if (bodyStr != null && !bodyStr.isEmpty()
                        && !"GET".equalsIgnoreCase(method)
                        && !"HEAD".equalsIgnoreCase(method)) {
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
                    is = wrapDecodedStream(is, conn.getContentEncoding());
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
            callback.onComplete(responseObj);
        });
    }

    public WebResourceResponse handleProxyFetch(Uri uri) {
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
            return emptyResponse(headers);
        }

        HttpURLConnection conn = null;
        try {
            String currentUrl = targetUrl;
            int retries = 0;
            for (int redirects = 0; redirects < 8; redirects++) {
                try {
                    URL u = new URL(currentUrl);
                    conn = (HttpURLConnection) u.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(20000);
                    conn.setRequestMethod("GET");
                    conn.setRequestProperty("User-Agent", userAgent);
                    conn.setRequestProperty("Accept", "*/*");
                    conn.setRequestProperty("Accept-Encoding", "gzip, deflate, identity");
                    try {
                        String cookie = CookieManager.getInstance().getCookie(currentUrl);
                        if (cookie != null && !cookie.isEmpty()) {
                            conn.setRequestProperty("Cookie", cookie);
                        }
                    } catch (Exception ignored) {
                    }

                    int status = conn.getResponseCode();
                    if ((status == 429 || status == 502 || status == 503 || status == 504) && retries < 2) {
                        conn.disconnect();
                        retries++;
                        redirects--;
                        try {
                            Thread.sleep(350L * retries);
                        } catch (InterruptedException ignored) {
                            Thread.currentThread().interrupt();
                        }
                        continue;
                    }
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
                        return emptyResponse(headers);
                    }

                    InputStream rawStream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                    if (rawStream == null) {
                        conn.disconnect();
                        return emptyResponse(headers);
                    }
                    rawStream = wrapDecodedStream(rawStream, conn.getContentEncoding());

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
                            return emptyResponse(headers);
                        }
                        bos.write(buf, 0, r);
                    }
                    rawStream.close();
                    conn.disconnect();

                    String cleanMime = ctype != null ? ctype.split(";")[0].trim() : "application/octet-stream";
                    return new WebResourceResponse(cleanMime, null, 200, "OK", headers,
                            new ByteArrayInputStream(bos.toByteArray()));
                } catch (Exception stepErr) {
                    if (conn != null) conn.disconnect();
                    if (retries < 2) {
                        retries++;
                        redirects--;
                        try {
                            Thread.sleep(300L * retries);
                        } catch (InterruptedException ignored) {
                            Thread.currentThread().interrupt();
                        }
                        continue;
                    }
                    throw stepErr;
                }
            }
            headers.put("X-Fetch-Error", "too_many_redirects");
        } catch (Exception e) {
            headers.put("X-Fetch-Error", e.getMessage() != null ? e.getMessage() : "network_error");
            if (conn != null) conn.disconnect();
        }
        return emptyResponse(headers);
    }

    public void fetchBinaryAsync(
            final int id,
            final String targetUrl,
            final long maxBytes,
            final ResponseCallback callback) {
        httpPool.execute(() -> {
            JSONObject res = new JSONObject();
            HttpURLConnection conn = null;
            try {
                res.put("id", id);
                if (targetUrl == null || targetUrl.isEmpty()) {
                    res.put("error", "missing_url");
                    callback.onComplete(res);
                    return;
                }
                String currentUrl = targetUrl;
                int retries = 0;
                for (int redirects = 0; redirects < 8; redirects++) {
                    try {
                        URL u = new URL(currentUrl);
                        conn = (HttpURLConnection) u.openConnection();
                        conn.setInstanceFollowRedirects(false);
                        conn.setConnectTimeout(10000);
                        conn.setReadTimeout(15000);
                        conn.setRequestMethod("GET");
                        conn.setRequestProperty("User-Agent", userAgent);
                        conn.setRequestProperty("Accept", "*/*");
                        conn.setRequestProperty("Accept-Encoding", "gzip, deflate, identity");
                        try {
                            String cookie = CookieManager.getInstance().getCookie(currentUrl);
                            if (cookie != null && !cookie.isEmpty()) {
                                conn.setRequestProperty("Cookie", cookie);
                            }
                        } catch (Exception ignored) {
                        }

                        int status = conn.getResponseCode();
                        if ((status == 429 || status == 502 || status == 503 || status == 504) && retries < 2) {
                            conn.disconnect();
                            retries++;
                            redirects--;
                            try {
                                Thread.sleep(250L * retries);
                            } catch (InterruptedException ignored) {
                                Thread.currentThread().interrupt();
                            }
                            continue;
                        }
                        if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                            String loc = conn.getHeaderField("Location");
                            conn.disconnect();
                            if (loc == null) break;
                            currentUrl = new URL(u, loc).toString();
                            continue;
                        }

                        res.put("finalUrl", conn.getURL().toString());
                        res.put("status", status);
                        String ctype = conn.getContentType();
                        if (ctype != null) res.put("contentType", ctype);

                        long contentLength = conn.getContentLengthLong();
                        if (contentLength > maxBytes) {
                            res.put("error", "too_big");
                            conn.disconnect();
                            callback.onComplete(res);
                            return;
                        }

                        if (status < 200 || status >= 300) {
                            res.put("error", "HTTP " + status);
                            conn.disconnect();
                            callback.onComplete(res);
                            return;
                        }

                        InputStream rawStream = conn.getInputStream();
                        if (rawStream == null) {
                            res.put("error", "empty");
                            conn.disconnect();
                            callback.onComplete(res);
                            return;
                        }
                        rawStream = wrapDecodedStream(rawStream, conn.getContentEncoding());

                        ByteArrayOutputStream bos = new ByteArrayOutputStream(
                                contentLength > 0 && contentLength <= 262144 ? (int) contentLength : 16384);
                        byte[] buf = new byte[16384];
                        long total = 0;
                        int r;
                        while ((r = rawStream.read(buf)) != -1) {
                            total += r;
                            if (total > maxBytes) {
                                rawStream.close();
                                conn.disconnect();
                                res.put("error", "too_big");
                                callback.onComplete(res);
                                return;
                            }
                            bos.write(buf, 0, r);
                        }
                        rawStream.close();
                        conn.disconnect();

                        byte[] bytes = bos.toByteArray();
                        res.put("ok", true);
                        if (bytes.length <= 65536) {
                            res.put("b64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                        } else {
                            blobStore.put(id, bytes);
                            res.put("blobId", id);
                        }
                        callback.onComplete(res);
                        return;
                    } catch (Exception stepErr) {
                        if (conn != null) conn.disconnect();
                        if (retries < 2) {
                            retries++;
                            redirects--;
                            try {
                                Thread.sleep(200L * retries);
                            } catch (InterruptedException ignored) {
                                Thread.currentThread().interrupt();
                            }
                            continue;
                        }
                        throw stepErr;
                    }
                }
                res.put("error", "too_many_redirects");
            } catch (Exception e) {
                try {
                    res.put("id", id);
                    res.put("error", e.getMessage() != null ? e.getMessage() : "network_error");
                } catch (Exception ignored) {
                }
                if (conn != null) conn.disconnect();
            }
            callback.onComplete(res);
        });
    }

    public WebResourceResponse handleBlobFetch(Uri uri) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "no-store");
        int id = -1;
        try {
            String idStr = uri.getQueryParameter("id");
            if (idStr != null) id = Integer.parseInt(idStr);
        } catch (Exception ignored) {
        }
        byte[] data = id >= 0 ? blobStore.remove(id) : null;
        if (data == null) {
            return new WebResourceResponse("application/octet-stream", null, 404, "Not Found", headers,
                    new ByteArrayInputStream(new byte[0]));
        }
        return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers,
                new ByteArrayInputStream(data));
    }

    private static InputStream wrapDecodedStream(InputStream raw, String encoding) throws Exception {
        if (encoding == null) return raw;
        String lower = encoding.toLowerCase();
        if (lower.contains("gzip")) return new GZIPInputStream(raw);
        if (lower.contains("deflate")) return new InflaterInputStream(raw);
        return raw;
    }

    private static WebResourceResponse emptyResponse(Map<String, String> headers) {
        return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers,
                new ByteArrayInputStream(new byte[0]));
    }

    public void shutdown() {
        blobStore.clear();
        httpPool.shutdownNow();
    }
}

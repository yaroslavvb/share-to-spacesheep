package dev.spacesheep.share;

import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * RFC 8252 loopback OAuth 2.1 redirect listener on 127.0.0.1.
 * Handles browser TCP preconnects and /favicon.ico requests without dropping the listener
 * before the actual /oauth?code=... redirect arrives.
 */
public final class OAuthLoopbackServer {
    private static final String TAG = "SpacesheepShare";
    private static final int TIMEOUT_MS = 300_000;

    public interface CallbackListener {
        void onOAuthResult(JSONObject result);
        void onBringToForeground();
    }

    private final ExecutorService executor;
    private final CallbackListener listener;
    private final Map<Integer, ServerSocket> sockets = new ConcurrentHashMap<>();
    private final AtomicInteger nextId = new AtomicInteger(1);

    public OAuthLoopbackServer(ExecutorService executor, CallbackListener listener) {
        this.executor = executor;
        this.listener = listener;
    }

    public String prepareLoopbackJson() {
        try {
            int id = nextId.getAndIncrement();
            ServerSocket serverSocket = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
            int port = serverSocket.getLocalPort();
            sockets.put(id, serverSocket);
            JSONObject obj = new JSONObject();
            obj.put("id", id);
            obj.put("redirectUri", "http://127.0.0.1:" + port + "/oauth");
            return obj.toString();
        } catch (Exception e) {
            Log.e(TAG, "Failed to bind OAuth loopback socket", e);
            return "{}";
        }
    }

    public void listenForCallback(final int id) {
        final ServerSocket serverSocket = sockets.get(id);
        if (serverSocket == null) return;

        executor.execute(() -> {
            JSONObject res = new JSONObject();
            try {
                res.put("id", id);
                long deadline = System.currentTimeMillis() + TIMEOUT_MS;
                String callbackUrl = null;

                while (System.currentTimeMillis() < deadline && callbackUrl == null) {
                    int remaining = (int) Math.max(1000L, deadline - System.currentTimeMillis());
                    serverSocket.setSoTimeout(remaining);
                    try (Socket client = serverSocket.accept()) {
                        client.setSoTimeout(5000);
                        BufferedReader reader = new BufferedReader(
                                new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
                        String requestLine = reader.readLine();
                        if (requestLine == null || !requestLine.startsWith("GET ")) {
                            continue;
                        }
                        String[] parts = requestLine.split(" ");
                        String path = parts.length >= 2 ? parts[1] : "";

                        // Ignore favicon or non-oauth preflight requests
                        if (!path.startsWith("/oauth") || (!path.contains("code=") && !path.contains("error="))) {
                            String emptyResp = "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";
                            OutputStream os = client.getOutputStream();
                            os.write(emptyResp.getBytes(StandardCharsets.UTF_8));
                            os.flush();
                            continue;
                        }

                        callbackUrl = "http://127.0.0.1:" + serverSocket.getLocalPort() + path;
                        String intentUrl = "intent://oauth#Intent;scheme=spacesheep-share;package=com.yaroslavvb.sheepit;end";
                        String html = "<!doctype html><html><head><meta charset='utf-8'>" +
                                "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
                                "<title>Connected to Spacesheep</title>" +
                                "<style>body{font:16px/1.45 -apple-system,BlinkMacSystemFont,Roboto,sans-serif;" +
                                "padding:40px 24px;text-align:center;background:#faf8f5;color:#1c1917;}" +
                                ".card{max-width:380px;margin:0 auto;padding:28px 22px;background:#fff;" +
                                "border:1px solid #e7e2da;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.06);}" +
                                "h2{margin:0 0 8px;font-size:20px;}p{margin:0 0 20px;color:#57534e;font-size:14px;}" +
                                ".btn{display:inline-block;padding:12px 22px;background:#1c1917;color:#fff;" +
                                "text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;}</style></head>" +
                                "<body><div class='card'><h2>✓ Connected to Spacesheep</h2>" +
                                "<p>Your account is now linked. Returning to SheepIt…</p>" +
                                "<a class='btn' href='" + intentUrl + "'>Return to SheepIt</a></div>" +
                                "<script>setTimeout(function(){location.replace('" + intentUrl + "');},150);</script>" +
                                "</body></html>";
                        byte[] bodyBytes = html.getBytes(StandardCharsets.UTF_8);
                        String httpResp = "HTTP/1.1 200 OK\r\n" +
                                "Content-Type: text/html; charset=utf-8\r\n" +
                                "Content-Length: " + bodyBytes.length + "\r\n" +
                                "Cache-Control: no-store\r\n" +
                                "Connection: close\r\n\r\n";
                        OutputStream os = client.getOutputStream();
                        os.write(httpResp.getBytes(StandardCharsets.UTF_8));
                        os.write(bodyBytes);
                        os.flush();
                    } catch (SocketTimeoutException ste) {
                        break;
                    }
                }

                if (callbackUrl != null) {
                    res.put("url", callbackUrl);
                    listener.onBringToForeground();
                } else {
                    res.put("error", "OAuth sign-in timed out before completing");
                }
            } catch (Exception e) {
                try {
                    res.put("id", id);
                    res.put("error", e.getMessage() != null ? e.getMessage() : "OAuth sign-in cancelled");
                } catch (Exception ignored) {
                }
            } finally {
                sockets.remove(id);
                try {
                    serverSocket.close();
                } catch (Exception ignored) {
                }
            }
            listener.onOAuthResult(res);
        });
    }

    public void shutdown() {
        for (ServerSocket s : sockets.values()) {
            try {
                s.close();
            } catch (Exception ignored) {
            }
        }
        sockets.clear();
    }
}

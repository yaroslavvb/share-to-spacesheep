// Native HTTP, offscreen DOM snapshot, and OAuth loopback bridge for Android WebView,
// with standard fetch fallback so the same modules also run in Node.js on the computer.

let nextReqId = 1;
const pendingHttp = new Map();
const pendingSnapshot = new Map();
const pendingSnapshotAsset = new Map();
const pendingOAuth = new Map();
let pendingPickedFiles = null;
let snapshotWebViewActive = false;

if (typeof window !== "undefined") {
  window.__onHttpResponse = (res) => {
    const p = pendingHttp.get(res.id);
    if (!p) return;
    pendingHttp.delete(res.id);
    if (res.error) p.reject(new Error(res.error));
    else p.resolve(res);
  };

  window.__onSnapshotResponse = (res) => {
    const p = pendingSnapshot.get(res.id);
    if (!p) return;
    pendingSnapshot.delete(res.id);
    p.resolve(res);
  };

  window.__onSnapshotAssetResponse = (res) => {
    const p = pendingSnapshotAsset.get(res.id);
    if (!p) return;
    pendingSnapshotAsset.delete(res.id);
    p.resolve(res);
  };

  window.__onOAuthCallback = (res) => {
    const p = pendingOAuth.get(res.id);
    if (!p) return;
    pendingOAuth.delete(res.id);
    if (res.error) p.reject(new Error(res.error));
    else p.resolve(res.url);
  };

  window.__onFilesPicked = (files) => {
    if (pendingPickedFiles) {
      const resolve = pendingPickedFiles;
      pendingPickedFiles = null;
      resolve(files || []);
    }
  };
}

export const hasAndroidBridge = () => typeof window !== "undefined" && !!window.AndroidBridge;

/**
 * Perform an HTTP request bypassing WebView CORS restrictions.
 * Returns { status, ok, headers: Map, text(), json() }.
 */
export async function nativeFetch(url, { method = "GET", headers = {}, body = null, isBase64Body = false } = {}) {
  if (!hasAndroidBridge()) {
    let reqBody = body;
    if (isBase64Body && typeof body === "string") {
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      reqBody = bytes;
    }
    const resp = await fetch(url, { method, headers, body: reqBody });
    const text = await resp.text();
    const hdrMap = new Map();
    resp.headers.forEach((v, k) => hdrMap.set(k.toLowerCase(), v));
    return {
      status: resp.status,
      ok: resp.ok,
      url: resp.url || url,
      headers: { get: (k) => hdrMap.get(String(k).toLowerCase()) || null },
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  }

  const id = nextReqId++;
  return new Promise((resolve, reject) => {
    pendingHttp.set(id, {
      resolve: (res) => {
        const hdrs = res.headers || {};
        const text = res.body || "";
        resolve({
          status: res.status,
          ok: res.status >= 200 && res.status < 300,
          url: res.finalUrl || url,
          headers: {
            get: (k) => {
              const lower = String(k).toLowerCase();
              for (const [hk, hv] of Object.entries(hdrs)) {
                if (hk.toLowerCase() === lower) return hv;
              }
              return null;
            },
          },
          text: async () => text,
          json: async () => JSON.parse(text),
        });
      },
      reject,
    });
    window.AndroidBridge.httpRequestAsync(
      id,
      url,
      method,
      JSON.stringify(headers || {}),
      body == null ? "" : String(body),
      !!isBase64Body
    );
  });
}

/**
 * Fetch binary asset bytes (HTML, CSS, image, font, PDF, etc.) bypassing CORS.
 * Returns { url, finalUrl, bytes: Uint8Array, type: string } or { url, error: string }.
 */
export async function fetchBinaryUrl(url, maxBytes = 25 * 1024 * 1024) {
  if (!hasAndroidBridge()) {
    try {
      const r = await fetch(url, { redirect: "follow" });
      if (!r.ok) return { url, error: `HTTP ${r.status}` };
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > maxBytes) return { url, error: "too_big" };
      return { url, finalUrl: r.url || url, bytes: buf, type: r.headers.get("content-type") || "" };
    } catch (e) {
      return { url, error: String(e.message || e) };
    }
  }

  if (window.AndroidBridge && window.AndroidBridge.fetchBinaryBase64) {
    try {
      const raw = window.AndroidBridge.fetchBinaryBase64(url, Number(maxBytes));
      const res = JSON.parse(raw || "{}");
      if (!res.ok) return { url, error: res.error || `HTTP ${res.status || 0}` };
      const bin = atob(res.base64 || "");
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (bytes.length > maxBytes) return { url, error: "too_big" };
      return {
        url,
        finalUrl: res.finalUrl || url,
        bytes,
        type: res.contentType || "",
      };
    } catch (e) {
      return { url, error: String(e.message || e) };
    }
  }

  try {
    const proxyUrl = `https://appassets.spacesheep.invalid/__fetch?url=${encodeURIComponent(url)}&maxBytes=${Number(maxBytes)}`;
    const r = await fetch(proxyUrl);
    const err = r.headers.get("x-fetch-error");
    if (err) {
      if (snapshotWebViewActive) {
        const viaWv = await fetchViaSnapshotWebView(url, maxBytes);
        if (viaWv && viaWv.bytes) return viaWv;
      }
      return { url, error: err };
    }
    const status = Number(r.headers.get("x-http-status") || r.status);
    if (status < 200 || status >= 300) {
      if (snapshotWebViewActive) {
        const viaWv = await fetchViaSnapshotWebView(url, maxBytes);
        if (viaWv && viaWv.bytes) return viaWv;
      }
      return { url, error: `HTTP ${status}` };
    }
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > maxBytes) return { url, error: "too_big" };
    return {
      url,
      finalUrl: r.headers.get("x-final-url") || url,
      bytes,
      type: r.headers.get("x-orig-type") || r.headers.get("content-type") || "",
    };
  } catch (e) {
    if (snapshotWebViewActive) {
      const viaWv = await fetchViaSnapshotWebView(url, maxBytes);
      if (viaWv && viaWv.bytes) return viaWv;
    }
    return { url, error: String(e.message || e) };
  }
}

async function fetchViaSnapshotWebView(url, maxBytes = 25 * 1024 * 1024) {
  if (!hasAndroidBridge() || !window.AndroidBridge.fetchSnapshotAsset) {
    return null;
  }
  const id = nextReqId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingSnapshotAsset.delete(id);
      resolve(null);
    }, 10000);
    pendingSnapshotAsset.set(id, {
      resolve: (res) => {
        clearTimeout(timer);
        if (!res || !res.ok || !res.base64) {
          resolve(res && res.error === "too_big" ? { url, error: "too_big" } : null);
          return;
        }
        try {
          const bin = atob(res.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          resolve({
            url,
            finalUrl: res.finalUrl || url,
            bytes,
            type: res.contentType || "",
          });
        } catch {
          resolve(null);
        }
      },
    });
    window.AndroidBridge.fetchSnapshotAsset(id, url, Number(maxBytes));
  });
}

/**
 * Render a webpage in an offscreen Android WebView and return its post-JS DOM snapshot.
 * Returns { ok, html, title, finalUrl }.
 */
export async function renderPageDom(url, timeoutMs = 5500) {
  if (!hasAndroidBridge() || !window.AndroidBridge.renderPageSnapshot) {
    return { ok: false };
  }
  const id = nextReqId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingSnapshot.delete(id);
      resolve({ ok: false });
    }, timeoutMs + 1500);
    pendingSnapshot.set(id, {
      resolve: (res) => {
        clearTimeout(timer);
        if (res && res.ok) snapshotWebViewActive = true;
        resolve(res || { ok: false });
      },
    });
    window.AndroidBridge.renderPageSnapshot(id, url, timeoutMs);
  });
}

export function resetSnapshotWebView() {
  snapshotWebViewActive = false;
  if (hasAndroidBridge() && window.AndroidBridge.resetPageSnapshot) {
    try {
      window.AndroidBridge.resetPageSnapshot();
    } catch {}
  }
}

/**
 * Allocate a loopback port on 127.0.0.1 for native OAuth 2.1 PKCE callback.
 */
export function prepareLoopbackOAuth() {
  if (!hasAndroidBridge() || !window.AndroidBridge.prepareOAuthLoopback) return null;
  const info = JSON.parse(window.AndroidBridge.prepareOAuthLoopback());
  return info; // { id, redirectUri }
}

export function waitForLoopbackOAuth(id, authorizeUrl) {
  return new Promise((resolve, reject) => {
    pendingOAuth.set(id, { resolve, reject });
    window.AndroidBridge.launchOAuthLoopback(id, authorizeUrl);
  });
}

export function pickDeviceFiles() {
  if (!hasAndroidBridge() || !window.AndroidBridge.pickFiles) return Promise.resolve([]);
  return new Promise((resolve) => {
    pendingPickedFiles = resolve;
    window.AndroidBridge.pickFiles();
  });
}

// Native HTTP, offscreen DOM snapshot, and OAuth loopback bridge for Android & iOS WebViews,
// with standard fetch fallback so the same modules also run in Node.js on the computer.

let nextReqId = 1;
const pendingHttp = new Map();
const pendingBinary = new Map();
const pendingSnapshot = new Map();
const pendingSnapshotAsset = new Map();
const pendingOAuth = new Map();
let pendingPickedFiles = null;
let snapshotWebViewActive = false;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

if (typeof window !== "undefined") {
  window.__onHttpResponse = (res) => {
    const p = pendingHttp.get(res.id);
    if (!p) return;
    pendingHttp.delete(res.id);
    if (res.error) p.reject(new Error(res.error));
    else p.resolve(res);
  };

  window.__onBinaryResponse = (res) => {
    const p = pendingBinary.get(res.id);
    if (!p) return;
    pendingBinary.delete(res.id);
    p.resolve(res);
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
 * Returns { status, ok, headers: { get }, text(), json() }.
 */
export async function nativeFetch(url, { method = "GET", headers = {}, body = null, isBase64Body = false } = {}) {
  if (!hasAndroidBridge()) {
    const reqBody = isBase64Body && typeof body === "string" ? b64ToBytes(body) : body;
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

function shouldFallbackToSnapshotWebView(errorStr, statusNum, url) {
  if (!snapshotWebViewActive) return false;
  if (errorStr === "too_big") return false;
  if (statusNum === 404 || statusNum === 410 || statusNum === 400) return false;
  if (/\.(?:mp4|webm|ogv|mov|m4v|mp3|wav|ogg|flac|m4a)(?:[?#]|$)/i.test(String(url || ""))) return false;
  return true;
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

  try {
    const id = nextReqId++;
    const res = await new Promise((resolve) => {
      pendingBinary.set(id, { resolve });
      window.AndroidBridge.fetchBinaryAsync(id, url, Number(maxBytes));
    });
    if (!res || !res.ok) {
      const errStr = (res && res.error) || `HTTP ${(res && res.status) || 0}`;
      const statusNum = Number((res && res.status) || 0);
      if (shouldFallbackToSnapshotWebView(errStr, statusNum, url)) {
        const viaWv = await fetchViaSnapshotWebView(url, maxBytes);
        if (viaWv && (viaWv.bytes || viaWv.error === "too_big")) return viaWv;
      }
      return { url, error: errStr };
    }
    let bytes;
    if (typeof res.b64 === "string") {
      bytes = b64ToBytes(res.b64);
    } else if (res.blobId !== undefined) {
      const blobResp = await fetch(`https://appassets.spacesheep.invalid/__blob?id=${res.blobId}`);
      bytes = new Uint8Array(await blobResp.arrayBuffer());
    } else {
      bytes = new Uint8Array(0);
    }
    if (bytes.length > maxBytes) return { url, error: "too_big" };
    return {
      url,
      finalUrl: res.finalUrl || url,
      bytes,
      type: res.contentType || "",
    };
  } catch (e) {
    if (shouldFallbackToSnapshotWebView(null, 0, url)) {
      const viaWv = await fetchViaSnapshotWebView(url, maxBytes);
      if (viaWv && (viaWv.bytes || viaWv.error === "too_big")) return viaWv;
    }
    return { url, error: String(e.message || e) };
  }
}

async function fetchViaSnapshotWebView(url, maxBytes = 25 * 1024 * 1024) {
  if (!hasAndroidBridge() || !window.AndroidBridge.fetchSnapshotAsset) return null;
  const id = nextReqId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingSnapshotAsset.delete(id);
      resolve(null);
    }, 2500);
    pendingSnapshotAsset.set(id, {
      resolve: (res) => {
        clearTimeout(timer);
        if (!res || !res.ok || !res.base64) {
          resolve(res && res.error === "too_big" ? { url, error: "too_big" } : null);
          return;
        }
        try {
          resolve({
            url,
            finalUrl: res.finalUrl || url,
            bytes: b64ToBytes(res.base64),
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
 * Render a webpage in an offscreen WebView and return its post-JS DOM snapshot.
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
    }, timeoutMs + 3000);
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
    try { window.AndroidBridge.resetPageSnapshot(); } catch {}
  }
}

export function prepareLoopbackOAuth() {
  if (!hasAndroidBridge() || !window.AndroidBridge.prepareOAuthLoopback) return null;
  return JSON.parse(window.AndroidBridge.prepareOAuthLoopback());
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

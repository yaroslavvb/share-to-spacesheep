// Core reading, webpage capturing, file building, and spacesheep MCP publishing engine.
import { extension } from "./browser.js";
import { isConnected, signIn, AuthError } from "./auth.js";
import { Mcp } from "./mcp.js";
import { capturePolicy } from "./capture-plan.js";
import { fitToPlan } from "./plan.js";
import { kindOf, titleFromName } from "./kinds.js";
import { fileName } from "./refs.js";
import { buildSingle, buildMany } from "./build.js";
import { captureWeb } from "./capture.js";
import { fetchBinaryUrl, nativeFetch, renderPageDom, resetSnapshotWebView } from "./native-http.js";

export const LIMITS = {
  files: 1000,
  fileBytes: 25 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
  mainBytes: 500 * 1024 * 1024,
};

const INLINE_BYTES = 1.5 * 1024 * 1024;
const MOVED_KEEP = 300;
const EMOJI = {
  page: "📄",
  image: "🖼️",
  pdf: "📕",
  video: "🎬",
  audio: "🎧",
  text: "📝",
  file: "📦",
  site: "🌐",
  collection: "🗂️",
};

export class ReadError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function decodeHtml(bytes, contentType = "") {
  const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType || "")?.[1] || "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** Extract a standalone URL from shared text if the text is a shared link. */
export function extractUrlFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (/^https?:\/\/\S+$/i.test(raw)) return raw;
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 2 && /^https?:\/\/\S+$/i.test(lines[1])) {
    return lines[1];
  }
  if (lines.length === 1) {
    const m = /(https?:\/\/[^\s<>"]+)$/i.exec(lines[0]);
    if (m && lines[0].length - m[1].length < 140) return m[1];
  }
  return null;
}

export async function getAccount() {
  const { account } = await extension.storage.local.get("account");
  return account || null;
}

export async function learnAccount(url) {
  const handle = (String(url || "").match(/\/@([a-z0-9][a-z0-9_-]*)\//i) || [])[1];
  if (!handle) return;
  const prev = (await getAccount()) || {};
  await extension.storage.local.set({ account: { ...prev, handle } });
}

/**
 * Verify current credentials against mcp.spacesheep.dev and persist @username + display name.
 */
export async function verifyAndLearnAccount() {
  const mcp = new Mcp();
  const info = await mcp.call("get_account", {});
  const text = typeof info === "string" ? info : JSON.stringify(info || "");
  const handle = (text.match(/Username:\s*@([a-z0-9][a-z0-9_-]*)/i) || [])[1] || null;
  const name = (text.match(/Name:\s*([^\r\n]+)/i) || [])[1]?.trim() || null;
  const prev = (await getAccount()) || {};
  const next = {
    ...prev,
    ...(handle ? { handle } : {}),
    ...(name ? { name } : {}),
  };
  if (next.handle || next.name) {
    await extension.storage.local.set({ account: next });
  }
  return next;
}

/**
 * Change a published space's visibility ("private" | "signed_in" | "public").
 */
export async function updateSpaceVisibility(uuid, visibility) {
  if (!uuid || !visibility) throw new Error("Missing space UUID or visibility");
  const mcp = new Mcp();
  await mcp.call("share_space", { uuid, visibility });
  return visibility;
}

export async function getMovedMap() {
  const { moved } = await extension.storage.local.get("moved");
  return moved || {};
}

export async function getMovedForUrl(sourceUrl) {
  if (!sourceUrl) return null;
  const all = await getMovedMap();
  return all[sourceUrl] || null;
}

export async function rememberMoved(sourceUrl, entry) {
  const all = await getMovedMap();
  all[sourceUrl] = entry;
  const keys = Object.keys(all);
  if (keys.length > MOVED_KEEP) {
    keys
      .sort((a, b) => (all[a].at || 0) - (all[b].at || 0))
      .slice(0, keys.length - MOVED_KEEP)
      .forEach((k) => delete all[k]);
  }
  await extension.storage.local.set({ moved: all });
}

function cleanSpacesheepArtifacts(doc) {
  for (const el of doc.querySelectorAll(".ss-print-mark, [data-ss-chrome]")) {
    el.remove();
  }
}

/**
 * Read and capture a shared http(s):// URL into a space file set.
 */
export async function readSharedUrl(url, suggestedTitle = "", onStep = () => {}, policy = null) {
  onStep("page");
  const main = await fetchBinaryUrl(url, LIMITS.mainBytes);
  let finalUrl = (main && main.finalUrl) || url;
  let html = "";
  let doc = null;
  let captureBaseUrl = finalUrl;
  let derivedTitle = "";
  let alreadyRenderedInWebView = false;

  if (!main || !main.bytes) {
    if (main && main.error === "too_big") {
      throw new ReadError("too_big", "This file is over 500 MB, more than Spacesheep reads.");
    }
    // Many Cloudflare-protected sites return HTTP 403/503 to HttpURLConnection
    // but load cleanly in the real Chromium WebView (renderPageDom).
    const fallbackRender = await renderPageDom(url, 12000);
    const fallbackUrl = String((fallbackRender && fallbackRender.finalUrl) || "");
    if (
      fallbackRender &&
      fallbackRender.ok &&
      fallbackRender.html &&
      !fallbackUrl.startsWith("chrome-error:") &&
      !fallbackUrl.startsWith("about:")
    ) {
      const renderedDoc = new DOMParser().parseFromString(fallbackRender.html, "text/html");
      const isErrorPage = !!renderedDoc.querySelector("#main-frame-error, .neterror");
      if (!isErrorPage && renderedDoc.body && renderedDoc.body.innerHTML.trim().length > 0) {
        doc = renderedDoc;
        cleanSpacesheepArtifacts(doc);
        finalUrl = fallbackUrl || url;
        captureBaseUrl = finalUrl;
        alreadyRenderedInWebView = true;
        if (fallbackRender.title) {
          derivedTitle = fallbackRender.title.replace(/\s*[—-]\s*spacesheep$/i, "").trim();
        }
      }
    }
    if (!doc) {
      throw new ReadError(
        "page_unreachable",
        `Couldn't load ${ url } (${ (main && main.error) || "connection failed" }).`
      );
    }
  } else {
    const rawType = (main.type || "").split(";")[0].trim().toLowerCase();
    const kind = kindOf(rawType, fileName(finalUrl));

    // Non-HTML file (image, PDF, video, audio, Markdown, CSV, JSON, text, archive)
    if (kind !== "page") {
      onStep("file");
      const name = fileName(finalUrl) || new URL(finalUrl).hostname;
      const blob = new Blob([main.bytes], { type: rawType || "application/octet-stream" });
      const built = await buildSingle({ name, type: rawType, blob, title: suggestedTitle || undefined }, onStep);
      return {
        title: built.title,
        kind: built.kind,
        note: built.note,
        sourceUrl: finalUrl,
        name,
        isFile: false,
        size: blob.size,
        files: built.files,
        skipped: { outside: 0, missing: 0, tooBig: 0, overLimit: 0 },
        snapshot: false,
        bytes: built.files.reduce((n, f) => n + f.blob.size, 0),
      };
    }

    html = decodeHtml(main.bytes, main.type);
    doc = new DOMParser().parseFromString(html, "text/html");
  }

  // Check if this is a spacesheep.dev viewer page wrapping an inner content iframe,
  // or a private spacesheep.dev space that redirected to /signin.
  const origHost = (() => {
    try { return new URL(url).hostname; } catch { return ""; }
  })();

  if (origHost === "spacesheep.dev" && finalUrl.includes("/signin") && (await isConnected())) {
    try {
      const mcp = new Mcp();
      const rawSpace = await mcp.call("read_space", { uuid: url });
      const text = typeof rawSpace === "string" ? rawSpace : JSON.stringify(rawSpace);
      const parts = text.split(/^--- (.+?)(?: \(\d+ bytes\))? ---\n/m);
      if (parts.length >= 3) {
        const idx = parts.findIndex((p, i) => i % 2 === 1 && p === "index.html");
        const contentHtml = idx > 0 ? parts[idx + 1] : parts[2];
        doc = new DOMParser().parseFromString(contentHtml, "text/html");
        cleanSpacesheepArtifacts(doc);
        captureBaseUrl = url;
      }
    } catch {}
  }

  const contentIframe = doc.querySelector('iframe#content[src*="spacesheep.app"]');
  if (contentIframe) {
    const spaceTitleEl = doc.querySelector("#spaceTitle");
    derivedTitle =
      (spaceTitleEl && spaceTitleEl.textContent.trim()) ||
      (doc.title || "").replace(/\s*[—-]\s*spacesheep$/i, "").trim();
    const iframeSrc = new URL(contentIframe.getAttribute("src"), finalUrl).href;
    const inner = await fetchBinaryUrl(iframeSrc, LIMITS.mainBytes);
    if (inner && inner.bytes && inner.bytes.length) {
      captureBaseUrl = inner.finalUrl || iframeSrc;
      html = decodeHtml(inner.bytes, inner.type);
      doc = new DOMParser().parseFromString(html, "text/html");
      cleanSpacesheepArtifacts(doc);
    }
  }

  // Try live DOM rendering in the offscreen WebView so client-side JS and canvases render
  if (!alreadyRenderedInWebView) {
    const rendered = await renderPageDom(captureBaseUrl, 4500);
    const renderedUrl = String((rendered && rendered.finalUrl) || "");
    if (
      rendered &&
      rendered.ok &&
      rendered.html &&
      !renderedUrl.startsWith("chrome-error:") &&
      !renderedUrl.startsWith("about:")
    ) {
      const renderedDoc = new DOMParser().parseFromString(rendered.html, "text/html");
      const isErrorPage = !!renderedDoc.querySelector("#main-frame-error, .neterror");
      if (!isErrorPage && renderedDoc.body && renderedDoc.body.innerHTML.trim().length > 0) {
        doc = renderedDoc;
        cleanSpacesheepArtifacts(doc);
        if (renderedUrl && /^https?:\/\//i.test(renderedUrl)) {
          captureBaseUrl = renderedUrl;
          if (!contentIframe) finalUrl = renderedUrl;
        }
        if (!derivedTitle && rendered.title) {
          derivedTitle = rendered.title.replace(/\s*[—-]\s*spacesheep$/i, "").trim();
        }
      }
    }
  }

  const readAssets = (urls) => Promise.all(urls.map((u) => fetchBinaryUrl(u, LIMITS.fileBytes)));
  const maxAssets = policy?.max_assets ?? LIMITS.files;
  let captured;
  try {
    captured = await captureWeb(doc, captureBaseUrl, readAssets, { ...LIMITS, files: maxAssets }, onStep);
  } finally {
    resetSnapshotWebView();
  }

  const name = fileName(finalUrl) || new URL(finalUrl).hostname;
  const rawDocTitle = (doc.title || "").replace(/\s*[—-]\s*spacesheep$/i, "").trim();
  const cleanSuggested = (suggestedTitle || "").replace(/\s*[—-]\s*spacesheep$/i, "").trim();
  const finalTitle = derivedTitle || rawDocTitle || cleanSuggested || name;

  return {
    ...captured,
    capture: policy
      ? {
          plan: policy.plan,
          limit: policy.max_assets,
          omitted: captured.skipped.overLimit,
          copied: captured.files.length - 1,
        }
      : null,
    title: finalTitle,
    kind: "page",
    sourceUrl: url,
    name,
    snapshot: true,
    isFile: false,
  };
}

/**
 * Read shared or picked device files into a space file set.
 * `descriptors`: [{ id, name, type, size, path? }]
 */
export async function readSharedFiles(descriptors, suggestedTitle = "", onStep = () => {}) {
  onStep("file");
  const items = [];
  for (const d of descriptors) {
    const r = await fetch(`https://appassets.spacesheep.invalid/__shared_file?id=${encodeURIComponent(d.id)}`);
    if (!r.ok) throw new ReadError("no_access", `Couldn't read ${d.name || "file"}`);
    const buf = await r.arrayBuffer();
    const type = d.type || r.headers.get("content-type") || "application/octet-stream";
    const name = d.name || "file";
    items.push({
      path: d.path || name,
      name,
      type,
      blob: new Blob([buf], { type }),
    });
  }

  const built =
    items.length === 1
      ? await buildSingle({ ...items[0], title: suggestedTitle || undefined }, onStep)
      : await buildMany(items, suggestedTitle || null, onStep);

  return {
    title: built.title,
    kind: built.kind,
    note: built.note,
    sourceUrl: null,
    name: items.length === 1 ? items[0].name : `${items.length} files`,
    isFile: true,
    size: items.reduce((n, i) => n + i.blob.size, 0),
    files: built.files,
    skipped: { outside: 0, missing: 0, tooBig: 0, overLimit: 0 },
    snapshot: false,
    bytes: built.files.reduce((n, f) => n + f.blob.size, 0),
  };
}

/**
 * Read shared plain text or Markdown snippet into a space file set.
 */
export async function readSharedText(text, suggestedTitle = "", onStep = () => {}) {
  onStep("file");
  const firstLine =
    String(text || "")
      .split(/\r?\n/)
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find(Boolean) || "Shared note";
  const title = suggestedTitle || firstLine.slice(0, 80);
  const name = `${titleFromName(title) || "note"}.md`;
  const blob = new Blob([String(text || "")], { type: "text/markdown;charset=utf-8" });
  const built = await buildSingle({ name, type: "text/markdown", blob, title }, onStep);
  return {
    title: built.title,
    kind: built.kind,
    note: built.note,
    sourceUrl: null,
    name,
    isFile: true,
    size: blob.size,
    files: built.files,
    skipped: { outside: 0, missing: 0, tooBig: 0, overLimit: 0 },
    snapshot: false,
    bytes: built.files.reduce((n, f) => n + f.blob.size, 0),
  };
}

async function inlineFile(f) {
  const bytes = new Uint8Array(await f.blob.arrayBuffer());
  if (f.html) {
    try {
      return { path: f.path, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    } catch {}
  }
  return { path: f.path, content: toB64(bytes), encoding: "base64" };
}

async function stageFiles(begin, files, onProgress) {
  if (!begin || !begin.upload_url) throw new Error("spacesheep didn't open an upload");
  const out = new Array(files.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      const f = files[i];
      const bytes = new Uint8Array(await f.blob.arrayBuffer());
      const r = await nativeFetch(`${begin.upload_url}?path=${encodeURIComponent(f.path)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: toB64(bytes),
        isBase64Body: true,
      });
      let body = {};
      try {
        body = await r.json();
      } catch {}
      if (!r.ok || !body.sha) {
        throw new Error(`upload of ${f.path} failed: ${body.error || `HTTP ${r.status}`}`);
      }
      out[i] = { path: f.path, staged_sha: body.sha };
      done++;
      onProgress({ step: "uploading", done, of: files.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker));
  return out;
}

/**
 * Publish a prepared page/file set to spacesheep.dev via MCP.
 */
export async function publishPage(page, { uuid = null, visibility = null, remember = true, onProgress = () => {} } = {}) {
  onProgress({ step: "connecting", title: page.title, done: 0, of: page.files.length });
  if (!(await isConnected())) {
    await signIn();
  }
  const mcp = new Mcp();

  if (page.capture) {
    const current = capturePolicy(await mcp.call("get_capture_limits"));
    if (current.max_assets < page.files.length - 1) {
      throw Object.assign(
        new Error(`Your ${current.plan} plan allows ${current.max_assets} assets per page.`),
        { code: "plan_changed" }
      );
    }
  }

  const all = page.files;
  const total = all.reduce((n, f) => n + f.blob.size, 0);
  let files;
  let dropped = [];
  if (total <= INLINE_BYTES) {
    files = await Promise.all(all.map(inlineFile));
  } else {
    const stageArgs = uuid ? { space: uuid, title: page.title } : { title: page.title };
    if (visibility) stageArgs.visibility = visibility;
    const begin = await mcp.call("stage_begin", stageArgs);
    const fit = fitToPlan(all, begin && begin.limits, begin && begin.plan);
    dropped = fit.dropped;
    onProgress({ step: "uploading", title: page.title, done: 0, of: fit.keep.length, dropped });
    files = await stageFiles(begin, fit.keep, (p) => onProgress({ ...p, title: page.title, dropped }));
  }

  onProgress({ step: "publishing", title: page.title });
  const args = {
    files,
    version_name: `${uuid ? "Updated" : "Moved"} from Spacesheep`,
  };
  if (uuid) {
    args.uuid = uuid;
  } else {
    Object.assign(args, { title: page.title, emoji: EMOJI[page.kind] || "📄" });
  }
  if (visibility) {
    args.access = { visibility };
  }

  const result = await mcp.call("deploy", args);
  const spaceId = result && (result.uuid || result.id || result.space_id);
  if (!spaceId || !result.url) {
    throw new Error("spacesheep answered without a link — check your dashboard before trying again");
  }

  if (remember && page.sourceUrl) {
    await rememberMoved(page.sourceUrl, {
      uuid: spaceId,
      url: result.url,
      title: page.title,
      at: Date.now(),
    });
  }
  await learnAccount(result.url);

  return {
    uuid: spaceId,
    url: result.url,
    title: page.title,
    update: !!uuid,
    visibility: result.visibility || null,
    unchanged: !!result.unchanged,
    dropped,
    capture: page.capture || null,
  };
}

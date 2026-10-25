// Core reading, webpage capturing, file building, and spacesheep MCP publishing engine.
import { extension } from "./browser.js";
import { isConnected, signIn, AuthError } from "./auth.js";
import { Mcp, warmMcpConnection } from "./mcp.js";
import { capturePolicy } from "./capture-plan.js";
import { fitToPlan } from "./plan.js";
import { kindOf, titleFromName, KIND_ICON } from "./kinds.js";
import { fileName } from "./refs.js";
import { buildSingle, buildMany } from "./build.js";
import { captureWeb, decode } from "./capture.js";
import { neutralizeCapturedHtml } from "./capture-refs.js";
import { fetchBinaryUrl, nativeFetch, renderPageDom, resetSnapshotWebView } from "./native-http.js";

export const LIMITS = {
  files: 1000,
  fileBytes: 25 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
  mainBytes: 500 * 1024 * 1024,
};

const INLINE_BYTES = 8 * 1024 * 1024;
const MOVED_KEEP = 300;
const EMPTY_SKIPPED = { outside: 0, missing: 0, tooBig: 0, overLimit: 0 };
const stripSpacesheepSuffix = (s) => String(s || "").replace(/\s*[—-]\s*spacesheep$/i, "").trim();

export class ReadError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
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

function needsLiveDomRender(doc) {
  if (!doc || !doc.body) return true;
  if (doc.querySelector("canvas, .drawer_container, d-article, d-title, d-math, d-figure, d-byline")) {
    return true;
  }
  if (!doc.querySelector('link[rel~="stylesheet" i], style') && doc.querySelector("script[src]")) {
    return true;
  }
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim().length < 350;
}

async function tryParseRenderedDom(url, timeoutMs) {
  const t0 = Date.now();
  const rendered = await renderPageDom(url, timeoutMs);
  const elapsedMs = Date.now() - t0;
  const finalUrl = String((rendered && rendered.finalUrl) || "");
  if (
    rendered &&
    rendered.ok &&
    rendered.html &&
    !finalUrl.startsWith("chrome-error:") &&
    !finalUrl.startsWith("about:")
  ) {
    const doc = new DOMParser().parseFromString(rendered.html, "text/html");
    const isErrorPage = !!doc.querySelector("#main-frame-error, .neterror");
    if (!isErrorPage && doc.body && doc.body.innerHTML.trim().length > 0) {
      cleanSpacesheepArtifacts(doc);
      return {
        doc,
        finalUrl: /^https?:\/\//i.test(finalUrl) ? finalUrl : url,
        title: rendered.title ? stripSpacesheepSuffix(rendered.title) : "",
        elapsedMs,
      };
    }
  }
  return { doc: null, finalUrl: "", title: "", elapsedMs };
}

function makeBuiltPageResult(built, { sourceUrl = null, name, isFile, size }) {
  return {
    title: built.title,
    kind: built.kind,
    note: built.note,
    sourceUrl,
    name,
    isFile,
    size,
    files: built.files,
    skipped: { ...EMPTY_SKIPPED },
    snapshot: false,
    bytes: built.files.reduce((n, f) => n + f.blob.size, 0),
  };
}

/**
 * Read and capture a shared http(s):// URL into a space file set.
 */
export async function readSharedUrl(url, suggestedTitle = "", onStep = () => {}, policy = null) {
  onStep("page");
  warmMcpConnection();
  const t0 = Date.now();
  const main = await fetchBinaryUrl(url, LIMITS.mainBytes);
  const fetchMainMs = Date.now() - t0;
  let renderDomMs = 0;
  let finalUrl = (main && main.finalUrl) || url;
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
    const fallback = await tryParseRenderedDom(url, 12000);
    renderDomMs += fallback.elapsedMs;
    if (fallback.doc) {
      doc = fallback.doc;
      finalUrl = fallback.finalUrl;
      captureBaseUrl = finalUrl;
      alreadyRenderedInWebView = true;
      derivedTitle = fallback.title;
    } else {
      throw new ReadError(
        "page_unreachable",
        `Couldn't load ${url} (${(main && main.error) || "connection failed"}).`
      );
    }
  } else {
    const rawType = (main.type || "").split(";")[0].trim().toLowerCase();
    const kind = kindOf(rawType, fileName(finalUrl));

    if (kind !== "page") {
      onStep("file");
      const name = fileName(finalUrl) || new URL(finalUrl).hostname;
      const blob = new Blob([main.bytes], { type: rawType || "application/octet-stream" });
      const built = await buildSingle({ name, type: rawType, blob, title: suggestedTitle || undefined }, onStep);
      return makeBuiltPageResult(built, { sourceUrl: finalUrl, name, isFile: false, size: blob.size });
    }

    doc = new DOMParser().parseFromString(decode(main.bytes, main.type), "text/html");
  }

  // Check if this is a spacesheep.dev viewer page wrapping an inner content iframe,
  // or a private spacesheep.dev space that redirected to /signin.
  let origHost = "";
  try { origHost = new URL(url).hostname; } catch {}

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
    derivedTitle = (spaceTitleEl && spaceTitleEl.textContent.trim()) || stripSpacesheepSuffix(doc.title);
    const iframeSrc = new URL(contentIframe.getAttribute("src"), finalUrl).href;
    const inner = await fetchBinaryUrl(iframeSrc, LIMITS.mainBytes);
    if (inner && inner.bytes && inner.bytes.length) {
      captureBaseUrl = inner.finalUrl || iframeSrc;
      doc = new DOMParser().parseFromString(decode(inner.bytes, inner.type), "text/html");
      cleanSpacesheepArtifacts(doc);
    }
  }

  // Only run offscreen WebView rendering when the static HTML requires JS execution
  // (e.g., client-side KaTeX/MathJax auto-render, <canvas>, or an empty SPA shell).
  if (!alreadyRenderedInWebView && needsLiveDomRender(doc)) {
    const rendered = await tryParseRenderedDom(captureBaseUrl, 3000);
    renderDomMs += rendered.elapsedMs;
    if (rendered.doc) {
      doc = rendered.doc;
      captureBaseUrl = rendered.finalUrl;
      if (!contentIframe) finalUrl = rendered.finalUrl;
      if (!derivedTitle && rendered.title) derivedTitle = rendered.title;
    }
  }

  const readAssets = (urls) => Promise.all(urls.map((u) => fetchBinaryUrl(u, LIMITS.fileBytes)));
  const maxAssets = policy?.max_assets ?? LIMITS.files;
  let captured;
  const tCap0 = Date.now();
  try {
    captured = await captureWeb(
      doc,
      captureBaseUrl,
      readAssets,
      { ...LIMITS, files: maxAssets },
      onStep,
      { fastBudgetMs: 60 }
    );
  } catch (err) {
    resetSnapshotWebView();
    throw err;
  }
  const captureFastMs = Date.now() - tCap0;
  if (captured.runFullCapture) {
    const origRun = captured.runFullCapture;
    captured.runFullCapture = () => origRun().finally(() => resetSnapshotWebView());
  } else {
    resetSnapshotWebView();
  }

  const name = fileName(finalUrl) || new URL(finalUrl).hostname;
  const finalTitle =
    derivedTitle || stripSpacesheepSuffix(doc.title) || stripSpacesheepSuffix(suggestedTitle) || name;

  return {
    ...captured,
    timings: { fetchMainMs, renderDomMs, captureFastMs },
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

  return makeBuiltPageResult(built, {
    name: items.length === 1 ? items[0].name : `${items.length} files`,
    isFile: true,
    size: items.reduce((n, i) => n + i.blob.size, 0),
  });
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
  return makeBuiltPageResult(built, { name, isFile: true, size: blob.size });
}

const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y",
  ь: "", э: "e", ю: "yu", я: "ya",
  і: "i", ї: "yi", є: "ye", ґ: "g", ў: "w", ђ: "dj", ј: "j", љ: "lj", њ: "nj",
  ћ: "c", џ: "dz", ѓ: "g", ѕ: "dz", ќ: "k",
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k",
  λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t",
  υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
  ά: "a", έ: "e", ή: "i", ί: "i", ό: "o", ύ: "y", ώ: "o", ϊ: "i", ϋ: "y", ΐ: "i", ΰ: "y",
  ß: "ss", æ: "ae", œ: "oe", ø: "o", ð: "d", þ: "th", ł: "l", đ: "d",
};

export function slugifyTitle(title) {
  let out = "";
  for (const ch of String(title || "").toLowerCase()) {
    out += ch in TRANSLIT ? TRANSLIT[ch] : ch;
  }
  const slug = out
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "untitled";
}

async function inlineFile(f) {
  const bytes = new Uint8Array(await f.blob.arrayBuffer());
  if (f.html || /\.(?:html?|css|svg|txt|md|json|xml)$/i.test(f.path)) {
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const content = f.html || /\.html?$/i.test(f.path) ? neutralizeCapturedHtml(decoded) : decoded;
      return { path: f.path, content };
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
      let bytes = new Uint8Array(await f.blob.arrayBuffer());
      if (f.html || /\.html?$/i.test(f.path)) {
        try {
          const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          bytes = new TextEncoder().encode(neutralizeCapturedHtml(decoded));
        } catch {}
      }
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
  await Promise.all(Array.from({ length: Math.min(16, files.length) }, worker));
  return out;
}

async function prepareDeployFiles(mcp, fileList, { uuid = null, title, visibility = null, onProgress = null }) {
  const total = fileList.reduce((n, f) => n + f.blob.size, 0);
  if (total <= INLINE_BYTES) {
    return { files: await Promise.all(fileList.map(inlineFile)), dropped: [] };
  }
  const stageArgs = uuid ? { space: uuid, title } : { title };
  if (visibility) stageArgs.visibility = visibility;
  const begin = await mcp.call("stage_begin", stageArgs);
  const fit = fitToPlan(fileList, begin && begin.limits, begin && begin.plan);
  if (onProgress) {
    onProgress({ step: "uploading", title, done: 0, of: fit.keep.length, dropped: fit.dropped });
  }
  const files = await stageFiles(begin, fit.keep, (p) => {
    if (onProgress) onProgress({ ...p, title, dropped: fit.dropped });
  });
  return { files, dropped: fit.dropped };
}

function recordPublishedSpace(page, spaceId, url, remember) {
  if (remember && page.sourceUrl) {
    rememberMoved(page.sourceUrl, {
      uuid: spaceId,
      url,
      title: page.title,
      at: Date.now(),
    }).catch(() => {});
  }
  learnAccount(url).catch(() => {});
}

/**
 * Publish a prepared page/file set to spacesheep.dev via MCP.
 */
export async function publishPage(
  page,
  {
    uuid = null,
    visibility = null,
    remember = true,
    onProgress = () => {},
    onPhase1Confirmed = null,
    onBackgroundComplete = null,
    onBackgroundError = null,
  } = {}
) {
  onProgress({ step: "publishing", title: page.title, done: 0, of: page.files.length });
  if (!(await isConnected())) {
    await signIn();
  }
  const mcp = new Mcp();

  if (page.capture && page.skipped?.overLimit > 0 && (page.capture.limit || 0) <= 35) {
    try {
      const current = capturePolicy(await mcp.call("get_capture_limits"));
      await extension.storage.local.set({ cachedPolicy: current });
      if (page.sourceUrl && current.max_assets > (page.capture.limit || 0)) {
        const recaptured = await readSharedUrl(page.sourceUrl, page.title, () => {}, current);
        Object.assign(page, recaptured);
      }
    } catch {}
  }

  const initialFilesCount = page.files.length;
  const initialBytes = page.files.reduce((n, f) => n + f.blob.size, 0);
  const { files, dropped } = await prepareDeployFiles(mcp, page.files, {
    uuid,
    title: page.title,
    visibility,
    onProgress,
  });

  onProgress({ step: "publishing", title: page.title });
  const versionName = `${uuid ? "Updated" : "Moved"} from SheepIt`;
  const args = {
    files,
    version_name: versionName,
    title: page.title,
    ...(uuid ? { uuid } : { emoji: KIND_ICON[page.kind] || "📄" }),
    ...(visibility ? { access: { visibility } } : {}),
  };

  const priorMoved = page.sourceUrl ? await getMovedForUrl(page.sourceUrl) : null;
  const acct = await getAccount();
  const handle =
    (acct && acct.handle) ||
    (priorMoved && priorMoved.url && (priorMoved.url.match(/\/@([a-z0-9][a-z0-9_-]*)\//i) || [])[1]) ||
    null;
  const optimisticUrl =
    (uuid && priorMoved && priorMoved.uuid === uuid && priorMoved.url)
      ? priorMoved.url
      : handle
      ? `https://spacesheep.dev/@${handle}/${slugifyTitle(page.title)}`
      : null;

  const tDep0 = Date.now();
  const phase1Promise = mcp.call("deploy", args);

  let fastResult = null;
  if (optimisticUrl) {
    fastResult = await Promise.race([
      phase1Promise.then((r) => ({ ok: true, result: r })).catch((err) => ({ ok: false, err })),
      new Promise((r) => setTimeout(() => r(null), 250)),
    ]);
    if (fastResult && !fastResult.ok) {
      throw fastResult.err;
    }
  } else {
    fastResult = { ok: true, result: await phase1Promise };
  }

  const deployFastMs = Date.now() - tDep0;
  const immediateResult = fastResult ? fastResult.result : null;
  const immediateSpaceId = immediateResult
    ? immediateResult.uuid || immediateResult.id || immediateResult.space_id
    : uuid;
  const immediateUrl = immediateResult ? immediateResult.url : optimisticUrl;

  if (immediateResult && (!immediateSpaceId || !immediateUrl)) {
    throw new Error("spacesheep answered without a link — check your dashboard before trying again");
  }

  if (immediateResult) {
    recordPublishedSpace(page, immediateSpaceId, immediateUrl, remember);
  }

  let backgroundSync = null;
  if (!immediateResult || page.runFullCapture) {
    const fullCapturePromise = page.runFullCapture ? page.runFullCapture() : null;
    backgroundSync = (async () => {
      try {
        const tBg0 = Date.now();
        const result = immediateResult || (await phase1Promise);
        const phase1TotalMs = Date.now() - tDep0;
        const spaceId = result && (result.uuid || result.id || result.space_id);
        if (!spaceId || !result.url) {
          throw new Error("spacesheep answered without a link — check your dashboard before trying again");
        }
        if (!immediateResult) {
          recordPublishedSpace(page, spaceId, result.url, remember);
          if (onPhase1Confirmed) {
            onPhase1Confirmed({
              uuid: spaceId,
              url: result.url,
              visibility: result.visibility || visibility || null,
              unchanged: !!result.unchanged,
            });
          }
        }

        let finalFilesCount = initialFilesCount;
        let finalSkipped = page.skipped || { ...EMPTY_SKIPPED };
        let finalBytes = initialBytes;
        let fullCaptureMs = 0;
        let deployFullMs = 0;

        if (fullCapturePromise) {
          const fullCaptured = await fullCapturePromise;
          fullCaptureMs = Date.now() - tBg0;
          page.files = fullCaptured.files;
          page.skipped = fullCaptured.skipped;
          page.bytes = fullCaptured.bytes;
          finalFilesCount = fullCaptured.files.length;
          finalSkipped = fullCaptured.skipped;
          finalBytes = fullCaptured.bytes;
          if (page.capture) {
            page.capture.omitted = fullCaptured.skipped.overLimit;
            page.capture.copied = Math.max(0, fullCaptured.files.length - 1);
          }
          if (fullCaptured.files.length > initialFilesCount) {
            const tDep2 = Date.now();
            const { files: fullDeployFiles } = await prepareDeployFiles(mcp, fullCaptured.files, {
              uuid: spaceId,
              title: page.title,
            });
            await mcp.call("deploy", {
              uuid: spaceId,
              files: fullDeployFiles,
              version_name: versionName,
              background: true,
            });
            deployFullMs = Date.now() - tDep2;
          }
        }

        if (onBackgroundComplete) {
          onBackgroundComplete({
            uuid: spaceId,
            url: result.url,
            title: page.title,
            visibility: result.visibility || visibility || null,
            update: !!uuid,
            filesCount: finalFilesCount,
            assetsCopied: Math.max(0, finalFilesCount - 1),
            skipped: finalSkipped,
            bytes: finalBytes,
            timings: { ...(page.timings || {}), deployFastMs, phase1TotalMs, fullCaptureMs, deployFullMs },
          });
        }
      } catch (err) {
        if (!immediateResult && onBackgroundError) {
          onBackgroundError(err);
        }
      }
    })();
  }

  return {
    uuid: immediateSpaceId || null,
    url: immediateUrl,
    title: page.title,
    update: !!uuid,
    visibility: (immediateResult && immediateResult.visibility) || visibility || (priorMoved ? "public" : null),
    unchanged: !!(immediateResult && immediateResult.unchanged),
    dropped,
    capture: page.capture || null,
    filesCount: initialFilesCount,
    bytes: initialBytes,
    timings: { ...(page.timings || {}), deployFastMs },
    phase1Promise,
    backgroundSync,
  };
}

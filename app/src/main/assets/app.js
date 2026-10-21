// UI controller for Share to spacesheep (Android & computer).
import { extension } from "./lib/browser.js";
import { isConnected, signIn, signOut, saveApiKey } from "./lib/auth.js";
import { Mcp } from "./lib/mcp.js";
import { FREE_CAPTURE, capturePolicy, captureNotice } from "./lib/capture-plan.js";
import { KIND_WORD, humanSize } from "./lib/kinds.js";
import { hasAndroidBridge, pickDeviceFiles } from "./lib/native-http.js";
import {
  LIMITS,
  ReadError,
  extractUrlFromText,
  getAccount,
  getMovedMap,
  getMovedForUrl,
  readSharedUrl,
  readSharedFiles,
  readSharedText,
  publishPage,
} from "./lib/share-engine.js";

const view = document.getElementById("view");
const btnHome = document.getElementById("btn-home");
const btnPickFiles = document.getElementById("btn-pick-files");
const btnKeyToggle = document.getElementById("btn-key-toggle");
const keyBox = document.getElementById("key-box");
const keyInput = document.getElementById("key-input");

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const ICON = { page: "📄", image: "🖼️", pdf: "📕", video: "🎬", audio: "🎧", text: "📝", file: "📦", site: "🌐", collection: "🗂️" };

const WHO_CAN_OPEN = {
  private: "Only you can open it until you share it.",
  members: "Only people you invite can open it.",
  signed_in: "Anyone with the link can open it after signing in.",
  public: "Anyone with the link can open it.",
};

const STEP_WORDS = {
  connecting: () => "Connecting to spacesheep…",
  uploading: (j) => (j.of > 1 ? `Uploading ${j.done || 0} of ${j.of} files…` : "Uploading…"),
  publishing: () => "Publishing…",
};

let currentPage = null;

function reportNativeStatus(obj) {
  if (hasAndroidBridge() && window.AndroidBridge.reportStatus) {
    try {
      window.AndroidBridge.reportStatus(JSON.stringify(obj));
    } catch {}
  }
}

function copyText(text) {
  if (hasAndroidBridge() && window.AndroidBridge.copyToClipboard) {
    window.AndroidBridge.copyToClipboard(String(text || ""));
    return Promise.resolve();
  }
  return navigator.clipboard.writeText(String(text || ""));
}

function openExternal(url) {
  return extension.tabs.create({ url });
}

function show(id) {
  view.replaceChildren(document.getElementById(id).content.cloneNode(true));
  return view;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return url || "";
  }
}

async function renderFoot() {
  const connected = await isConnected();
  const account = await getAccount();
  const who = document.getElementById("who");
  const out = document.getElementById("disconnect");
  if (connected) {
    who.textContent = account && account.handle ? `Publishing as @${account.handle}` : "Connected to spacesheep";
    out.hidden = false;
  } else {
    who.textContent = "Not connected yet";
    out.hidden = true;
  }
}

document.getElementById("disconnect").addEventListener("click", async () => {
  await signOut();
  await renderFoot();
  if (currentPage) await renderReady(currentPage);
});

btnKeyToggle.addEventListener("click", () => {
  keyBox.hidden = !keyBox.hidden;
  if (!keyBox.hidden) keyInput.focus();
});

document.getElementById("key-cancel").addEventListener("click", () => {
  keyBox.hidden = true;
  keyInput.value = "";
});

document.getElementById("key-save").addEventListener("click", async () => {
  const raw = keyInput.value.trim();
  if (!raw) return;
  try {
    await saveApiKey(raw);
    keyInput.value = "";
    keyBox.hidden = true;
    await renderFoot();
    if (currentPage) await startPublish(currentPage, null);
  } catch (e) {
    renderProblem("invalid_key", String(e.message || e), { retry: () => renderLauncher() });
  }
});

btnHome.addEventListener("click", () => {
  currentPage = null;
  renderLauncher();
});

btnPickFiles.addEventListener("click", async () => {
  const picked = await pickDeviceFiles();
  if (picked && picked.length) {
    await processShare({ mode: "files", files: picked, title: "", autoPublish: true });
  }
});

async function renderLauncher() {
  btnHome.hidden = true;
  show("t-launcher");
  await renderFoot();

  const form = view.querySelector("#url-form");
  const input = view.querySelector("#url-input");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!url) return;
    await processShare({ mode: "url", url, title: "", autoPublish: true });
  });

  const moved = await getMovedMap();
  const entries = Object.entries(moved)
    .map(([sourceUrl, item]) => ({ sourceUrl, ...item }))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, 5);

  if (entries.length) {
    const wrap = view.querySelector("#recent-wrap");
    const list = view.querySelector("#recent-list");
    wrap.hidden = false;
    for (const item of entries) {
      const li = document.createElement("li");
      li.className = "recent-item";
      const info = document.createElement("div");
      info.className = "recent-info";
      const b = document.createElement("b");
      b.textContent = item.title || shortUrl(item.url);
      const span = document.createElement("span");
      span.textContent = shortUrl(item.url);
      info.append(b, span);

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "link";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", () => openExternal(item.url));

      li.append(info, openBtn);
      list.appendChild(li);
    }
  }
}

function renderWorking(job) {
  btnHome.hidden = false;
  if (!view.querySelector(".bar")) show("t-working");
  view.querySelector(".title").textContent = job.title || "This page";
  view.querySelector(".step").textContent = (STEP_WORDS[job.step] || (() => job.stepText || "Working…"))(job);
  const bar = view.querySelector(".bar");
  if (job.step === "uploading" && job.of > 1) {
    bar.classList.add("known");
    bar.querySelector("span").style.width = `${Math.max(8, Math.round(((job.done || 0) / job.of) * 100))}%`;
  } else {
    bar.classList.remove("known");
    bar.querySelector("span").style.width = "";
  }
}

async function renderReady(page) {
  currentPage = page;
  btnHome.hidden = false;
  show("t-ready");
  const connected = await isConnected();
  const before = await getMovedForUrl(page.sourceUrl);

  view.querySelector(".doc").textContent = ICON[page.kind] || "📄";
  view.querySelector(".title").textContent = page.title;
  const where = page.isFile ? page.name : shortUrl(page.sourceUrl);
  if (page.kind === "page") {
    const extra = page.files.length - 1;
    view.querySelector(".meta").textContent = `${where} · ${humanSize(page.bytes)}${
      extra ? ` · with ${plural(extra, "file", "files")} the page uses` : ""
    }`;
  } else {
    view.querySelector(".meta").textContent = `${where} · ${KIND_WORD[page.kind] || "file"} · ${humanSize(
      page.size || page.bytes
    )}`;
  }

  const notes = [];
  if (page.note) notes.push(page.note);
  if (page.snapshot) notes.push("Copied as the page shows it.");
  const { outside, missing, tooBig, overLimit } = page.skipped || {};
  if (outside) notes.push(`${plural(outside, "file", "files")} outside its folder won't come along.`);
  if (missing) notes.push(`${plural(missing, "file it loads couldn't", "files it loads couldn't")} be copied.`);
  if (tooBig) notes.push(`${plural(tooBig, "file was", "files were")} too big to bring.`);
  if (overLimit && !page.capture) {
    notes.push(`${plural(overLimit, "file exceeded", "files exceeded")} the ${LIMITS.files.toLocaleString()}-asset capture limit.`);
  }
  if (page.capture) notes.push(captureNotice(page.capture));
  if (page.capture && !connected) notes.push("Free preview. Connect to use your plan’s limit.");
  if (notes.length) {
    const p = view.querySelector(".notes");
    p.textContent = notes.join(" ");
    p.hidden = false;
  }

  const go = view.querySelector("#go");
  go.textContent = before ? "Update it on spacesheep" : "Move to spacesheep";
  go.addEventListener("click", () => startPublish(page, before ? before.uuid : null));
  if (before) {
    const asNew = view.querySelector("#as-new");
    asNew.hidden = false;
    asNew.addEventListener("click", () => startPublish(page, null));
  }
  if (!connected) view.querySelector(".first").hidden = false;
  const plans = view.querySelector(".capture-plans");
  plans.hidden = !page.capture?.omitted;
  plans.addEventListener("click", () => openExternal("https://spacesheep.dev/plans"));
}

async function renderDone(job) {
  btnHome.hidden = false;
  show("t-done");
  await renderFoot();

  view.querySelector(".title").textContent = job.title || "Moved";
  const what = job.unchanged ? "Already up to date" : job.update ? "Updated" : "Moved";
  view.querySelector(".meta").textContent = `${what} · ${WHO_CAN_OPEN[job.visibility] || "Open it to share it."}`;

  const urlEl = view.querySelector("#result-url");
  urlEl.textContent = job.url;
  urlEl.href = job.url;
  urlEl.addEventListener("click", (e) => {
    e.preventDefault();
    openExternal(job.url);
  });

  try {
    await copyText(job.url);
    view.querySelector("#copied-pill").hidden = false;
  } catch {}

  if (job.dropped && job.dropped.length) {
    const n = view.querySelector(".notes");
    n.textContent = `${plural(job.dropped.length, "full-size original was", "full-size originals were")} too big for your plan; the page shows a lighter copy.`;
    n.hidden = false;
  }
  if (job.capture) {
    const n = view.querySelector(".notes");
    n.textContent = [n.hidden ? "" : n.textContent, captureNotice(job.capture)].filter(Boolean).join(" ");
    n.hidden = false;
  }

  view.querySelector("#open").addEventListener("click", () => openExternal(job.url));
  view.querySelector("#copy").addEventListener("click", async (e) => {
    await copyText(job.url);
    e.target.textContent = "Copied";
  });

  if (job.update && currentPage) {
    const asNewAfter = view.querySelector("#as-new-after");
    asNewAfter.hidden = false;
    asNewAfter.addEventListener("click", () => startPublish(currentPage, null));
  }

  reportNativeStatus({
    step: "done",
    url: job.url,
    uuid: job.uuid,
    title: job.title,
    visibility: job.visibility,
    update: job.update,
  });
}

function renderProblem(code, message, { retry } = {}) {
  btnHome.hidden = false;
  show("t-problem");
  const titleMap = {
    too_big: "Too big for your plan",
    cancelled: "Sign-in was closed before it finished",
    denied: "The connection wasn't approved",
    signed_out: "Your spacesheep connection ended",
    revoked: "Your spacesheep connection ended",
    offline: "Couldn't reach spacesheep",
    unreachable: "Couldn't reach spacesheep",
    invalid_key: "That API key wasn't valid",
  };
  view.querySelector(".title").textContent = titleMap[code] || "It didn't move";
  view.querySelector(".why").textContent = message || "Something went wrong. Nothing was published.";
  const fix = view.querySelector("#fix");
  if (retry) {
    fix.hidden = false;
    fix.textContent = "Try again";
    fix.addEventListener("click", retry);
  }
  reportNativeStatus({ step: "error", code: code || "failed", message: String(message || "") });
}

function readingWords(step, a, b, c) {
  if (step === "assets") return `Reading ${plural(a, "file", "files")} beside it…`;
  if (step === "pdf") return `Drawing page ${b} of ${c}…`;
  if (step === "image") return "Preparing the picture…";
  if (step === "file") return "Reading the file…";
  return "Reading this page…";
}

async function startPublish(page, uuid = null) {
  currentPage = page;
  try {
    renderWorking({ step: "connecting", title: page.title });
    const outcome = await publishPage(page, {
      uuid,
      onProgress: (prog) => renderWorking(prog),
    });
    await renderDone(outcome);
  } catch (e) {
    await renderFoot();
    renderProblem(e && e.code, String((e && e.message) || e), {
      retry: () => startPublish(page, uuid),
    });
  }
}

export async function processShare(payload) {
  try {
    if (payload && payload.configureKey) {
      await saveApiKey(payload.configureKey, payload.configureHandle || null);
    }
    await renderFoot();

    if (!payload || payload.mode === "launcher") {
      await renderLauncher();
      return;
    }

    let mode = payload.mode;
    let url = payload.url;
    if (mode === "text") {
      const extracted = extractUrlFromText(payload.text);
      if (extracted) {
        mode = "url";
        url = extracted;
      }
    }

    const displayTitle = payload.title || (mode === "url" ? shortUrl(url) : "Shared item");
    renderWorking({ step: "reading", stepText: "Reading this page…", title: displayTitle });
    reportNativeStatus({ step: "reading", mode, url: url || null });

    const onStep = (step, a, b, c) => {
      const el = view.querySelector(".step");
      if (el) el.textContent = readingWords(step, a, b, c);
    };

    let page;
    if (mode === "url") {
      let policy = FREE_CAPTURE;
      if (await isConnected()) {
        try {
          policy = capturePolicy(await new Mcp().call("get_capture_limits"));
        } catch {}
      }
      page = await readSharedUrl(url, payload.title || "", onStep, policy);
    } else if (mode === "files") {
      page = await readSharedFiles(payload.files || [], payload.title || "", onStep);
    } else if (mode === "text") {
      page = await readSharedText(payload.text || "", payload.title || "", onStep);
    } else {
      await renderLauncher();
      return;
    }

    currentPage = page;
    const connected = await isConnected();
    const before = await getMovedForUrl(page.sourceUrl);

    if (connected && payload.autoPublish !== false) {
      await startPublish(page, before ? before.uuid : null);
    } else {
      await renderReady(page);
    }
  } catch (e) {
    if (e instanceof ReadError) {
      renderProblem(e.code, e.message, { retry: () => processShare(payload) });
    } else {
      renderProblem("failed", String((e && e.message) || e), { retry: () => processShare(payload) });
    }
  }
}

window.__handleIncomingShare = (payload) => {
  processShare(payload);
};

async function init() {
  let initial = { mode: "launcher" };
  if (hasAndroidBridge() && window.AndroidBridge.getInitialPayload) {
    try {
      initial = JSON.parse(window.AndroidBridge.getInitialPayload() || '{"mode":"launcher"}');
    } catch {}
  }
  await processShare(initial);
}

init();

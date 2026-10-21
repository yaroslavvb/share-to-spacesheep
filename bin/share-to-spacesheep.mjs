#!/usr/bin/env node
// Share a webpage URL or local file from the computer to spacesheep.dev using the
// same spacesheep viewer templates, asset packaging, and MCP tools as the Android app.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { kindOf, extOf, fileSlot, titleFromName } from "../app/src/main/assets/lib/kinds.js";
import { imagePage, videoPage, audioPage, textPage, filePage } from "../app/src/main/assets/lib/viewers.js";
import { rewriteCss } from "../app/src/main/assets/lib/capture-refs.js";

const DEFAULT_ORIGIN = "https://mcp.spacesheep.dev";
const PROTOCOL = "2025-06-18";

function readKey() {
  if (process.env.SPACESHEEP_KEY) return process.env.SPACESHEEP_KEY.trim();
  const cfgPath = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "spacesheep", "config.json");
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    return cfg.key || null;
  } catch {
    return null;
  }
}

class NodeMcp {
  constructor(origin, token) {
    this.origin = origin.replace(/\/$/, "");
    this.token = token;
    this.session = null;
    this.nextId = 1;
    this.ready = null;
  }

  async _post(body) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.token}`,
      "MCP-Protocol-Version": PROTOCOL,
    };
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    const resp = await fetch(`${this.origin}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const sid = resp.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    if (resp.status === 202 || resp.status === 204) return null;
    const text = await resp.text();
    if (!resp.ok) throw new Error(`spacesheep answered ${resp.status}: ${text.slice(0, 300)}`);
    if ((resp.headers.get("content-type") || "").includes("text/event-stream")) {
      let last = null;
      for (const line of text.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          const msg = JSON.parse(line.slice(5).trim());
          if (msg && msg.id !== undefined && msg.id === body.id) return msg;
          last = msg;
        } catch {}
      }
      return last;
    }
    return text ? JSON.parse(text) : null;
  }

  async call(name, args = {}) {
    if (!this.ready) {
      await this._post({
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL,
          capabilities: {},
          clientInfo: { name: "share-to-spacesheep-desktop", version: "0.3.2" },
        },
      });
      await this._post({ jsonrpc: "2.0", method: "notifications/initialized" });
      this.ready = true;
    }
    const msg = await this._post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    });
    if (!msg) throw new Error(`no answer from ${name}`);
    if (msg.error) throw new Error(msg.error.message || JSON.stringify(msg.error));
    const result = msg.result || {};
    const text = (result.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    let value = text;
    try {
      value = JSON.parse(text);
    } catch {}
    if (result.isError) throw new Error(typeof value === "string" ? value : value.message || text);
    return value;
  }
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.unref();
  } catch {}
}

async function captureUrlOnComputer(targetUrl, maxAssets = 40) {
  let resp = await fetch(targetUrl, { redirect: "follow" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${targetUrl}`);
  let finalUrl = resp.url || targetUrl;
  let html = await resp.text();
  let title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "")
    .replace(/\s+/g, " ")
    .replace(/\s*[—-]\s*spacesheep$/i, "")
    .trim();

  // Unwrap spacesheep.dev viewer iframe if present
  const iframeMatch = /<iframe[^>]+id=["']content["'][^>]+src=["'](https:\/\/[^"']*spacesheep\.app[^"']*)["']/i.exec(html);
  if (iframeMatch) {
    const innerUrl = new URL(iframeMatch[1], finalUrl).href;
    const innerResp = await fetch(innerUrl, { redirect: "follow" });
    if (innerResp.ok) {
      finalUrl = innerResp.url || innerUrl;
      html = await innerResp.text();
      html = html.replace(/<div class="ss-print-mark"[\s\S]*?<\/div>/gi, "");
      html = html.replace(/<script\b[^>]*data-ss-chrome[^>]*>[\s\S]*?<\/script>/gi, "");
    }
  }

  // Strip executable script tags
  html = html.replace(/<script\b(?![^>]*type=["'](?:application\/(?:ld\+)?json|text\/template)["'])[^>]*>[\s\S]*?<\/script>/gi, "");

  const files = [];
  const assetMap = new Map();

  async function downloadAsset(rawUrl, baseUrl) {
    let abs;
    try {
      const u = new URL(rawUrl, baseUrl);
      if (!/^https?:$/.test(u.protocol)) return rawUrl;
      u.hash = "";
      abs = u.href;
    } catch {
      return rawUrl;
    }
    if (assetMap.has(abs)) return assetMap.get(abs);
    if (assetMap.size >= maxAssets) return rawUrl;
    try {
      const r = await fetch(abs, { redirect: "follow" });
      if (!r.ok) return rawUrl;
      const bytes = Buffer.from(await r.arrayBuffer());
      const ctype = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const ext =
        {
          "text/css": "css",
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
          "image/svg+xml": "svg",
          "image/gif": "gif",
          "font/woff2": "woff2",
          "font/woff": "woff",
        }[ctype] ||
        /\.([a-z0-9]{1,8})$/i.exec(new URL(abs).pathname)?.[1] ||
        "bin";
      const rel = `_assets/${sha256Hex(abs)}.${ext.toLowerCase()}`;
      assetMap.set(abs, `./${rel}`);
      if (ext === "css" || ctype === "text/css") {
        const cssText = bytes.toString("utf-8");
        const rewritten = rewriteCss(cssText, (u) => {
          try {
            return new URL(u, r.url || abs).href;
          } catch {
            return u;
          }
        });
        files.push({ path: rel, content: rewritten });
      } else {
        files.push({ path: rel, content: bytes.toString("base64"), encoding: "base64" });
      }
      return `./${rel}`;
    } catch {
      return rawUrl;
    }
  }

  // Collect stylesheet & image URLs
  const attrRegex = /(<(?:img|link|source)\b[^>]*?\b(?:src|href)=["'])([^"']+)(["'])/gi;
  const matches = [...html.matchAll(attrRegex)];
  for (const m of matches) {
    const tag = m[1];
    const raw = m[2];
    if (/^<link\b/i.test(tag) && !/\brel=["']?(?:stylesheet|icon|shortcut|apple-touch-icon)/i.test(tag)) continue;
    await downloadAsset(raw, finalUrl);
  }

  html = html.replace(attrRegex, (full, prefix, raw, suffix) => {
    try {
      const u = new URL(raw, finalUrl);
      u.hash = "";
      if (assetMap.has(u.href)) return `${prefix}${assetMap.get(u.href)}${suffix}`;
    } catch {}
    return full;
  });

  files.unshift({ path: "index.html", content: html });
  return { title: title || new URL(finalUrl).hostname, kind: "page", files };
}

async function main() {
  const target = process.argv[2];
  if (!target || target === "--help" || target === "-h") {
    console.log("Usage: share-to-spacesheep <url-or-file> [--title <title>]");
    process.exit(0);
  }
  const titleIdx = process.argv.indexOf("--title");
  const customTitle = titleIdx > 2 ? process.argv[titleIdx + 1] : "";

  const key = readKey();
  if (!key) {
    console.error("Not signed in to spacesheep. Run `spacesheep login` or set SPACESHEEP_KEY.");
    process.exit(1);
  }

  const mcp = new NodeMcp(process.env.SPACESHEEP_ORIGIN || DEFAULT_ORIGIN, key);
  let built;
  if (/^https?:\/\//i.test(target)) {
    let maxAssets = 40;
    try {
      const lim = await mcp.call("get_capture_limits");
      if (lim && Number.isInteger(lim.max_assets)) maxAssets = lim.max_assets;
    } catch {}
    built = await captureUrlOnComputer(target, maxAssets);
    if (customTitle) built.title = customTitle;
  } else {
    const buf = fs.readFileSync(target);
    const name = path.basename(target);
    const kind = kindOf("", name);
    const title = customTitle || titleFromName(name);
    if (kind === "page") {
      built = { title, kind, files: [{ path: "index.html", content: buf.toString("utf-8") }] };
    } else {
      const slot = fileSlot(name, `file.${extOf(name) || "bin"}`);
      const html =
        kind === "image"
          ? imagePage({ title, file: slot, size: buf.length })
          : kind === "video"
          ? videoPage({ title, file: slot, size: buf.length })
          : kind === "audio"
          ? audioPage({ title, file: slot, size: buf.length })
          : kind === "text"
          ? textPage({ title, file: slot, size: buf.length, text: buf.toString("utf-8"), name })
          : filePage({ title, file: slot, size: buf.length, name });
      built = {
        title,
        kind,
        files: [
          { path: "index.html", content: html },
          { path: slot, content: buf.toString("base64"), encoding: "base64" },
        ],
      };
    }
  }

  const result = await mcp.call("deploy", {
    title: built.title,
    files: built.files,
    version_name: "Moved from Share to spacesheep",
  });
  console.log(result.url);
  openBrowser(result.url);
}

main().catch((e) => {
  console.error(`Error: ${e.message || e}`);
  process.exit(1);
});

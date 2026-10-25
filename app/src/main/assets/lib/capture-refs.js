// Rewrite load-bearing URLs while discovering them. Navigation links aren't assets.
import { LOADS, LINK_RELS } from "./refs.js";

export function assetUrl(raw, base) {
  const value = (raw || "").trim();
  if (!value || value.startsWith("#")) return null;
  try {
    const normalized = !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)
      && !/^(data|blob|javascript|mailto|about|tel|file):/i.test(value)
      && /^[^/\\?#]+:[^/\\]/.test(value)
      ? `./${value}`
      : value;
    const url = new URL(normalized, base);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch { return null; }
}

export function urlKey(url) {
  const key = new URL(url);
  key.hash = "";
  return key.href;
}

// A srcset URL may contain commas (especially data: images). Descriptors end at
// the next comma, whereas commas within a URL are part of that URL.
function scanSrcset(value, onToken) {
  let at = 0;
  while (at < value.length) {
    const start = at;
    while (at < value.length && /[\s,]/.test(value[at])) at++;
    const sep = value.slice(start, at);
    const urlStart = at;
    while (at < value.length && !/\s/.test(value[at])) at++;
    const token = value.slice(urlStart, at);
    if (!token) break;
    const commas = token.match(/,+$/)?.[0] || "";
    const url = commas ? token.slice(0, -commas.length) : token;
    let desc = "";
    if (!commas) {
      const descriptorStart = at;
      let depth = 0;
      while (at < value.length) {
        const c = value[at++];
        if (c === "(") depth++;
        if (c === ")") depth--;
        if (c === "," && depth === 0) break;
      }
      desc = value.slice(descriptorStart, at);
    }
    onToken(sep, url, commas, desc);
  }
}

export function rewriteSrcset(value, rewrite) {
  let result = "";
  const kept = [];
  let sawOmitted = false;
  scanSrcset(value, (sep, url, commas, desc) => {
    const rewritten = rewrite(url);
    if (rewritten === "data:,") sawOmitted = true;
    else kept.push(rewritten + (commas ? "" : desc.replace(/,\s*$/, "")));
    result += sep + rewritten + commas + desc;
  });
  return sawOmitted ? kept.join(", ") : result;
}

function unescapeCss(value) {
  return value.replace(/\\(?:([\da-f]{1,6})\s?|\r\n|[\n\r\f]|(.))/gi, (_, hex, char) => {
    if (!hex) return char || "";
    const n = parseInt(hex, 16);
    return n && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "\ufffd";
  });
}
const quotedCss = (value) => '"' + value.replace(/["\\\n\r\f]/g, (c) => `\\${c.codePointAt(0).toString(16)} `) + '"';

const ALLOWED_CDN_HOSTS = new Set([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "unpkg.com",
  "esm.sh",
  "cdn.tailwindcss.com",
  "code.jquery.com",
]);

export function isAllowedCdnAsset(urlInput, kind = "asset") {
  try {
    const u = urlInput instanceof URL ? urlInput : new URL(String(urlInput));
    const host = u.hostname.toLowerCase();
    if (!ALLOWED_CDN_HOSTS.has(host)) return false;
    if (host === "fonts.googleapis.com" || host === "fonts.gstatic.com") return true;
    if (kind === "stylesheet" || /\.(?:css|js|mjs|woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(u.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

export function stripLegacyFontFallbacks(cssText) {
  return String(cssText || "").replace(/@font-face\s*\{[\s\S]*?\}/gi, (block) => {
    if (!/\.woff2(?:[?#)'"\s]|$)/i.test(block)) return block;
    return block.replace(/src\s*:\s*([^;}]+)/gi, (srcDecl, srcList) => {
      const parts = [];
      let cur = "", depth = 0, quote = "";
      for (let i = 0; i < srcList.length; i++) {
        const c = srcList[i];
        if (quote) {
          if (c === "\\" && i + 1 < srcList.length) { cur += c + srcList[++i]; continue; }
          if (c === quote) quote = "";
          cur += c;
        } else {
          if (c === '"' || c === "'") quote = c;
          else if (c === "(") depth++;
          else if (c === ")") depth = Math.max(0, depth - 1);
          else if (c === "," && depth === 0) {
            parts.push(cur.trim());
            cur = "";
            continue;
          }
          cur += c;
        }
      }
      if (cur.trim()) parts.push(cur.trim());
      const filtered = parts.filter((p) => !/\.(?:woff|ttf|otf|eot)(?:[?#)'"\s]|$)/i.test(p) || /\.woff2(?:[?#)'"\s]|$)/i.test(p));
      return filtered.length ? `src:${filtered.join(",")}` : srcDecl;
    });
  });
}

// Skip comments and unrelated strings, so content:"url(...)" isn't a download.
// Also recognize quoted image-set candidates, imports and escaped CSS URLs.
export function rewriteCss(rawText, rewrite) {
  const text = stripLegacyFontFallbacks(rawText);
  const tokens = /\/\*[\s\S]*?\*\/|url\(\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|((?:\\[\s\S]|[^)\\])*))\s*\)|@import\s+(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)')|(?:-webkit-)?image-set\(|[\w-]+\(|[()]|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/gi;
  const stack = [];
  return text.replace(tokens, (match, double, single, bare, impDouble, impSingle, offset) => {
    if (match.startsWith("/*")) return match;
    if (double !== undefined || single !== undefined || bare !== undefined) {
      const raw = unescapeCss(double ?? single ?? bare.trim());
      const next = rewrite(raw, /@import\s*$/i.test(text.slice(0, offset)) ? "stylesheet" : /\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(raw) ? "asset" : "image");
      return next === raw ? match : `url(${quotedCss(next)})`;
    }
    if (impDouble !== undefined || impSingle !== undefined) {
      const raw = unescapeCss(impDouble ?? impSingle);
      const next = rewrite(raw, "stylesheet");
      return next === raw ? match : `@import ${quotedCss(next)}`;
    }
    if (match.endsWith("(")) { stack.push(/^(?:-webkit-)?image-set\(/i.test(match)); return match; }
    if (match === ")") { stack.pop(); return match; }
    if (stack.at(-1) && /^["']/.test(match)) {
      const raw = unescapeCss(match.slice(1, -1));
      const next = rewrite(raw, "image");
      return next === raw ? match : quotedCss(next);
    }
    return match;
  });
}

export function documentBase(doc, url) {
  try { return new URL(doc.querySelector("base[href]")?.getAttribute("href") || url, url).href; }
  catch { return url; }
}

export function stripScripts(doc) {
  let hasMathEngine = false;
  const hasPreRenderedMath = !!doc.querySelector(".MathJax, mjx-container, .katex");
  for (const el of doc.querySelectorAll("script")) {
    const type = (el.getAttribute("type") || "").trim().toLowerCase();
    const src = (el.getAttribute("src") || "").trim();
    const text = (el.textContent || "").trim();
    if (/^math\/tex/i.test(type)) {
      hasMathEngine = true;
      if (hasPreRenderedMath) {
        el.remove();
      } else if (doc.createElement) {
        const display = /mode\s*=\s*display/i.test(type);
        const span = doc.createElement("span");
        span.textContent = display ? `\\[${text}\\]` : `\\(${text}\\)`;
        el.replaceWith(span);
      }
      continue;
    }
    if (/(?:katex|mathjax)/i.test(src) || /(?:renderMathInElement|katexOptions|MathJax)/i.test(text)) {
      hasMathEngine = true;
    }
    el.remove();
  }
  if (hasPreRenderedMath) {
    for (const el of doc.querySelectorAll(".MJX_Assistive_MathML, mjx-assistive-mml, .MathJax_Preview")) {
      el.remove();
    }
  }
  if (hasMathEngine && doc.head && !doc.querySelector('meta[name="spacesheep:math" i]')) {
    const meta = doc.createElement("meta");
    meta.setAttribute("name", "spacesheep:math");
    meta.setAttribute("content", "tex");
    doc.head.appendChild(meta);
  }
  for (const el of doc.querySelectorAll('link[rel~="modulepreload" i], link[rel~="preload" i][as="script" i], link[rel~="preconnect" i], link[rel~="dns-prefetch" i]')) el.remove();
}

export function rewriteDocument(doc, rewrite) {
  const attribute = (el, name) => {
    const value = el.getAttribute(name);
    if (value === null) return;
    const tag = el.tagName.toLowerCase();
    const rel = el.getAttribute("rel") || "";
    const isStylesheet = tag === "link" && /(^|\s)stylesheet(\s|$)/i.test(rel);
    const image = tag === "img" || tag === "image" || name === "poster" || name === "imagesrcset"
      || (tag === "source" && el.parentElement?.tagName.toLowerCase() === "picture")
      || (tag === "input" && el.getAttribute("type") === "image")
      || (tag === "link" && (/icon/i.test(rel) || el.getAttribute("as") === "image"));
    const kind = isStylesheet ? "stylesheet" : image ? "image" : "asset";
    const visit = (raw) => rewrite(raw, kind);
    const next = name === "srcset" || name === "imagesrcset" ? rewriteSrcset(value, visit) : visit(value);
    if (next !== value) {
      if ((name === "srcset" || name === "imagesrcset") && next === "") {
        if (tag === "img" && el.getAttribute("src") && el.getAttribute("src") !== "data:,") {
          el.removeAttribute(name);
        } else if (tag === "source" && el.parentElement?.tagName.toLowerCase() === "picture") {
          el.remove();
          return;
        } else {
          el.setAttribute(name, "data:,");
        }
      } else {
        el.setAttribute(name, next);
      }
      // CSS and nested documents can change bytes; old integrity would block them.
      el.removeAttribute("integrity");
      el.removeAttribute("crossorigin");
    }
  };
  for (const el of doc.querySelectorAll("link")) {
    if (LINK_RELS.test(el.getAttribute("rel") || "")) {
      attribute(el, "href");
      attribute(el, "imagesrcset");
    }
  }
  for (const [tag, name] of LOADS) {
    for (const el of doc.querySelectorAll(tag)) attribute(el, name);
  }
  for (const el of doc.querySelectorAll("style")) el.textContent = rewriteCss((el.textContent || "").replace(/<!--[\s\S]*?-->/g, ""), rewrite);
  for (const el of doc.querySelectorAll("[style]")) el.setAttribute("style", rewriteCss(el.getAttribute("style"), rewrite));
  for (const name of ["fill", "stroke", "filter", "clip-path", "mask", "marker-start", "marker-mid", "marker-end"]) {
    for (const el of doc.querySelectorAll(`[${name}]`)) el.setAttribute(name, rewriteCss(el.getAttribute(name), rewrite));
  }
  for (const tpl of doc.querySelectorAll("template[shadowrootmode], template[shadowroot]")) {
    if (tpl.content) rewriteDocument(tpl.content, rewrite);
  }
}

// Pick the single highest-resolution URL from a srcset string so a <picture> or <img srcset>
// doesn't queue 6-8 redundant resolution/format variants per image.
export function bestSrcsetUrl(value) {
  if (!value || typeof value !== "string") return null;
  let bestUrl = null, bestScore = -1;
  scanSrcset(value, (_sep, rawUrl, commas, rawDesc) => {
    const url = rawUrl.trim();
    if (!url || url === "data:," || url === "about:blank") return;
    const desc = commas ? "" : rawDesc.replace(/,\s*$/, "").trim();
    const wMatch = /(\d+(?:\.\d+)?)w/i.exec(desc);
    const xMatch = /(\d+(?:\.\d+)?)x/i.exec(desc);
    const score = wMatch ? parseFloat(wMatch[1]) : xMatch ? parseFloat(xMatch[1]) * 1000 : 1;
    if (score >= bestScore) { bestScore = score; bestUrl = url; }
  });
  return bestUrl;
}

// Removing <base> keeps local assets local. Resolve navigation first so links and
// forms retain their destination, while fragment links still target this copy.
export function prepareDocument(doc, base, ownerDoc = doc) {
  stripScripts(doc);
  // Strip favicons, apple-touch-icons, and non-style preloads that aren't displayed inside
  // the Spacesheep iframe and otherwise consume 15+ head asset slots before body images.
  for (const el of doc.querySelectorAll(
    'link[rel~="icon" i], link[rel~="shortcut" i], link[rel~="apple-touch-icon" i], link[rel~="apple-touch-icon-precomposed" i], link[rel~="mask-icon" i], link[rel~="preload" i]:not([as="style" i]), link[rel~="prefetch" i], link[rel~="manifest" i]'
  )) {
    el.remove();
  }
  const sheetHrefs = new Set(
    [...doc.querySelectorAll('link[rel~="stylesheet" i][href]:not([rel~="preload" i])')].map((el) => el.getAttribute("href"))
  );
  for (const el of doc.querySelectorAll('link[rel~="preload" i][as="style" i]')) {
    const href = el.getAttribute("href");
    if (href && sheetHrefs.has(href)) {
      el.remove();
    } else {
      el.setAttribute("rel", "stylesheet");
      el.removeAttribute("as");
      if (href) sheetHrefs.add(href);
    }
  }
  // Normalize self-hosted or duplicate KaTeX stylesheets to a single allowlisted CDN link
  // so pages don't download 60-120 redundant .woff2/.woff/.ttf KaTeX font files.
  const seenStylesheets = new Set();
  for (const el of doc.querySelectorAll('link[rel~="stylesheet" i][href]')) {
    let href = (el.getAttribute("href") || "").trim();
    if (/(?:^|\/)katex(?:\.min)?\.css(?:[?#]|$)/i.test(href)) {
      href = "https://cdn.jsdelivr.net/npm/katex@0.16.2/dist/katex.min.css";
      el.setAttribute("href", href);
      el.removeAttribute("integrity");
      el.removeAttribute("crossorigin");
    }
    let resolvedHref = href;
    try { resolvedHref = new URL(href, base).href; } catch {}
    if (seenStylesheets.has(resolvedHref)) {
      el.remove();
    } else {
      seenStylesheets.add(resolvedHref);
    }
  }
  for (const el of doc.querySelectorAll('.osano-cm-window, #onetrust-consent-sdk, #onetrust-banner-sdk, #CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay, .qc-cmp2-container, .fc-consent-root, #truste-consent-track, #didomi-host, #usercentrics-root, .cky-consent-container, .cc-window, .cc-revoke, #cookie-law-info-bar, #cookie-notice, #iubenda-cs-banner, [id^="sp_message_container"], .cmplz-cookiebanner-container, #BorlabsCookieBox, #gdpr-cookie-message, .mw-notification-area, .postedit-container, [role="dialog"][aria-label*="Subscribe" i], [class*="subscribeDialog"], iframe[width="0"][height="0"], iframe.channel-frame')) {
    el.remove();
  }
  for (const el of doc.querySelectorAll("mdn-dropdown[loaded]")) {
    el.removeAttribute("loaded");
  }
  // Convert <object data="...svg"> and <embed src="...svg"> image embeds into <img>
  // so Spacesheep's object-src 'none' Content-Security-Policy doesn't block figures (e.g. ArXiv HTML).
  for (const el of doc.querySelectorAll("object[data], embed[src]")) {
    const isEmbed = el.tagName.toLowerCase() === "embed";
    const rawUrl = (el.getAttribute(isEmbed ? "src" : "data") || "").trim();
    const type = (el.getAttribute("type") || "").trim().toLowerCase();
    if (!rawUrl) continue;
    const isImage = type.startsWith("image/") || /\.(?:svg|png|jpe?g|gif|webp|avif|bmp|ico)(?:[?#]|$)/i.test(rawUrl);
    if (!isImage) continue;
    const img = ownerDoc.createElement("img");
    img.setAttribute("src", rawUrl);
    for (const attr of ["id", "class", "style", "width", "height", "title", "alt", "aria-label"]) {
      if (el.hasAttribute(attr)) img.setAttribute(attr, el.getAttribute(attr));
    }
    if (!img.hasAttribute("alt")) {
      const fallbackText = (el.textContent || "").trim();
      if (fallbackText) img.setAttribute("alt", fallbackText);
    }
    el.replaceWith(img);
  }
  // Replace live-rendered <canvas data-snapshot-src="data:image/png;base64,..."> with static <img>
  for (const canvas of doc.querySelectorAll("canvas[data-snapshot-src]")) {
    const dataUrl = (canvas.getAttribute("data-snapshot-src") || "").trim();
    if (!dataUrl.startsWith("data:image/")) continue;
    const img = ownerDoc.createElement("img");
    img.setAttribute("src", dataUrl);
    for (const attr of ["id", "class", "style", "width", "height", "title", "aria-label"]) {
      if (canvas.hasAttribute(attr)) img.setAttribute(attr, canvas.getAttribute(attr));
    }
    const w = canvas.getAttribute("data-snapshot-width");
    const h = canvas.getAttribute("data-snapshot-height");
    if (w && h && !/\bwidth\s*:/i.test(img.getAttribute("style") || "")) {
      const prevStyle = img.getAttribute("style") ? img.getAttribute("style").replace(/;?\s*$/, "; ") : "";
      img.setAttribute("style", `${prevStyle}width: ${w}px; height: ${h}px;`);
    }
    canvas.replaceWith(img);
  }
  for (const img of doc.querySelectorAll("img, source")) {
    const src = (img.getAttribute("src") || "").trim();
    const dataSrc = img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("data-original") || img.getAttribute("data-actualsrc");
    if (dataSrc && (!src || src.startsWith("data:"))) {
      img.setAttribute("src", dataSrc.trim());
    }
    const srcset = (img.getAttribute("srcset") || "").trim();
    const dataSrcset = img.getAttribute("data-srcset") || img.getAttribute("data-lazy-srcset");
    if (dataSrcset && !srcset) {
      img.setAttribute("srcset", dataSrcset.trim());
    }
    if (img.tagName.toLowerCase() === "img") {
      img.removeAttribute("loading");
      img.removeAttribute("decoding");
    }
  }
  // Collapse <picture> and <img srcset> multi-resolution variants to a single highest-res <img>
  // so each figure uses 1 asset slot instead of 6-8 redundant width/format copies.
  for (const pic of doc.querySelectorAll("picture")) {
    let img = pic.querySelector("img");
    if (!img && pic.querySelector("source[srcset], source[src]")) {
      img = ownerDoc.createElement("img");
      pic.appendChild(img);
    }
    if (!img) continue;
    const curSrc = (img.getAttribute("src") || "").trim();
    const bestImgSet = bestSrcsetUrl(img.getAttribute("srcset"));
    let bestSourceSet = null;
    for (const srcEl of pic.querySelectorAll("source[srcset], source[src]")) {
      const candidate = bestSrcsetUrl(srcEl.getAttribute("srcset") || srcEl.getAttribute("src"));
      if (candidate && !bestSourceSet) bestSourceSet = candidate;
      srcEl.remove();
    }
    const chosen = bestImgSet || (curSrc && !curSrc.startsWith("data:") ? curSrc : null) || bestSourceSet || curSrc;
    if (chosen) img.setAttribute("src", chosen);
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
  }
  for (const img of doc.querySelectorAll("img[srcset]")) {
    const curSrc = (img.getAttribute("src") || "").trim();
    const best = bestSrcsetUrl(img.getAttribute("srcset"));
    if (best) {
      img.setAttribute("src", best);
    }
    if (best || (curSrc && !curSrc.startsWith("data:"))) {
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
    }
  }
  // Resolve streaming media (video, audio, track, iframe) to absolute URLs so they play
  // directly from origin instead of blocking share on 100 MB media downloads.
  for (const el of doc.querySelectorAll("video[src], audio[src], video source[src], audio source[src], track[src], iframe[src]")) {
    const raw = (el.getAttribute("src") || "").trim();
    if (raw && !/^(?:data|blob|about|javascript):/i.test(raw)) {
      try { el.setAttribute("src", new URL(raw, base).href); } catch {}
    }
  }
  for (const el of doc.querySelectorAll("a[href], area[href]")) {
    const raw = el.getAttribute("href");
    if (raw && !raw.startsWith("#")) {
      try { el.setAttribute("href", new URL(raw, base).href); } catch {}
    }
  }
  // A captured page is a static reading snapshot, never a live login or checkout form.
  // Stripping form action/formaction and neutralizing password/card inputs prevents
  // embedded site headers (Sign In modals, PayPal donate forms, newsletter boxes)
  // from triggering deploy-time phishing content screening (credential-field + external-form-action).
  for (const el of doc.querySelectorAll("form[action]")) el.removeAttribute("action");
  for (const el of doc.querySelectorAll("[formaction]")) el.removeAttribute("formaction");
  for (const el of doc.querySelectorAll("input")) {
    if (/^password$/i.test((el.getAttribute("type") || "").trim())) {
      el.setAttribute("type", "text");
      el.setAttribute("disabled", "");
      el.setAttribute("readonly", "");
      if (el.getAttribute("value")) el.setAttribute("value", "••••••••");
    }
  }
  const credAttrPattern = /^(?:cc-number|card[-_]?number|cardnumber|cvv|cvc|security[-_]?code|ssn|social[-_]?security)/i;
  for (const el of doc.querySelectorAll("[name], [id], [autocomplete]")) {
    for (const attr of ["name", "id", "autocomplete"]) {
      const val = (el.getAttribute(attr) || "").trim();
      if (credAttrPattern.test(val)) {
        if (attr === "autocomplete" || attr === "name") el.removeAttribute(attr);
        else el.setAttribute(attr, `captured-${val}`);
      }
    }
  }
  for (const el of doc.querySelectorAll("base[href]")) el.removeAttribute("href");
  for (const el of doc.querySelectorAll('meta[http-equiv="content-security-policy" i], meta[http-equiv="refresh" i]')) el.remove();
  for (const el of doc.querySelectorAll('meta[charset], meta[http-equiv="content-type" i]')) el.remove();
  if (doc.head) {
    const charset = ownerDoc.createElement("meta");
    charset.setAttribute("charset", "utf-8");
    doc.head.prepend(charset);
  }
  for (const tpl of doc.querySelectorAll("template")) {
    if (tpl.content) prepareDocument(tpl.content, base, ownerDoc);
  }
}

export function neutralizeCapturedHtml(html) {
  return String(html || "")
    .replace(/(<input\b[^>]*?\btype\s*=\s*["']?)password\b/gi, "$1text")
    .replace(/(<form\b[^>]*?)\s+\baction\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+)/gi, "$1")
    .replace(/\b(name|id|autocomplete)(\s*=\s*["']?)(cc-number|card[-_]?number|cardnumber|cvv|cvc|security[-_]?code|ssn|social[-_]?security)/gi, "data-$1$2captured-$3");
}

// Asset reference constants and filename helpers shared by capture-refs.js.

export const LOADS = new Set(["img", "source", "video", "audio", "track", "script", "embed", "object", "input", "image", "use", "feimage"]);
export const LINK_RELS = new Set(["stylesheet", "icon", "shortcut icon", "apple-touch-icon", "apple-touch-icon-precomposed", "mask-icon", "preload"]);

export function fileName(raw, fallback = "asset") {
  const clean = raw.split("#")[0].split("?")[0];
  let seg = clean.slice(clean.lastIndexOf("/") + 1);
  try { seg = decodeURIComponent(seg); } catch {}
  seg = seg.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^\.+/, "");
  return seg || fallback;
}

export function isCss(path, type = "") {
  return type.includes("text/css") || /\.css$/i.test(path);
}

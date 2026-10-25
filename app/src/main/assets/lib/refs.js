// Elements whose attribute names a file the page loads (never <a href>: a link is
// somewhere to go, not part of the page).
export const LOADS = [
  ["img", "src"], ["img", "srcset"], ["source", "srcset"],
  ["script", "src"], ["video", "poster"],
  ["embed", "src"], ["object", "data"],
  ["input", "src"], ["image", "href"], ["image", "xlink:href"], ["use", "href"],
  ["use", "xlink:href"], ["feImage", "href"],
];
export const LINK_RELS = /(^|\s)(stylesheet|icon|shortcut|apple-touch-icon|mask-icon|preload|modulepreload|prefetch|manifest)(\s|$)/i;

/** The file name at the end of a URL, decoded ("my report.html"), or "". */
export function fileName(pageUrl) {
  const u = new URL(pageUrl);
  const last = u.pathname.slice(u.pathname.lastIndexOf("/") + 1);
  try { return decodeURIComponent(last); } catch { return last; }
}

/** Whether a file is a stylesheet whose own url()s are worth following. */
export const isCss = (path, type) => /\.css$/i.test(path) || /text\/css/i.test(type || "");

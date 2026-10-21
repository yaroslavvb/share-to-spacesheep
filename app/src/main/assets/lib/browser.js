// Browser/extension compatibility layer for Share to spacesheep (Android & computer).
import { hasAndroidBridge } from "./native-http.js";

const memStorage = new Map();

function readAllStorage() {
  if (hasAndroidBridge()) {
    try {
      return JSON.parse(window.AndroidBridge.storageGetAll() || "{}");
    } catch {
      return {};
    }
  }
  return Object.fromEntries(memStorage.entries());
}

export const extension = {
  runtime: {
    id: "dev.spacesheep.share",
    getURL(path = "") {
      const clean = String(path).replace(/^\/+/, "");
      return `https://appassets.spacesheep.invalid/${clean}`;
    },
    getManifest() {
      return { version: "0.3.2" };
    },
  },
  storage: {
    local: {
      async get(keys) {
        const all = readAllStorage();
        if (keys == null) return all;
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) {
          if (Object.prototype.hasOwnProperty.call(all, k)) out[k] = all[k];
        }
        return out;
      },
      async set(patch) {
        if (hasAndroidBridge()) {
          window.AndroidBridge.storageSet(JSON.stringify(patch || {}));
        } else {
          for (const [k, v] of Object.entries(patch || {})) memStorage.set(k, v);
        }
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        if (hasAndroidBridge()) {
          window.AndroidBridge.storageRemove(JSON.stringify(list));
        } else {
          for (const k of list) memStorage.delete(k);
        }
      },
    },
  },
  tabs: {
    async create({ url }) {
      if (hasAndroidBridge() && window.AndroidBridge.openExternalUrl) {
        window.AndroidBridge.openExternalUrl(url);
      }
      return { url };
    },
  },
};

export const isFirefox = false;
export const browserName = "Android";
export const isAndroidBuild = true;

export function resultTabOptions(url) {
  return { url };
}

// Signing in: OAuth 2.1 with PKCE (RFC 8252 loopback redirect) and API key support
// against spacesheep's MCP server (https://mcp.spacesheep.dev).
import { extension } from "./browser.js";
import { nativeFetch, prepareLoopbackOAuth, waitForLoopbackOAuth } from "./native-http.js";

export const SERVER = "https://mcp.spacesheep.dev";
export const APP_SERVER = "https://spacesheep.dev";
export const CLIENT_NAME = "Spacesheep";

export class AuthError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

export async function serverOrigin() {
  const { server } = await extension.storage.local.get("server");
  return (server || SERVER).replace(/\/$/, "");
}

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function s256(text) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

async function jsonOrNull(resp) {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

async function registerClient(server, redirectUri) {
  const resp = await nativeFetch(`${server}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const body = await jsonOrNull(resp);
  if (!resp.ok || !body || !body.client_id) {
    throw new AuthError("unreachable", `spacesheep didn't answer the sign-in (HTTP ${resp.status})`);
  }
  return { server, client_id: body.client_id, redirect_uri: redirectUri, name: CLIENT_NAME, registered_at: Date.now() };
}

async function tokenRequest(server, fields) {
  const resp = await nativeFetch(`${server}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  const body = await jsonOrNull(resp);
  if (!resp.ok || !body || !body.access_token) {
    const why = (body && (body.error_description || body.error)) || `HTTP ${resp.status}`;
    throw new AuthError(body && body.error === "invalid_grant" ? "revoked" : "unreachable", why);
  }
  return body;
}

async function keep(server, clientId, tokens) {
  const auth = {
    kind: "oauth",
    server,
    client_id: clientId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
  };
  await extension.storage.local.set({ auth });
  return auth;
}

let signingIn = null;
export function signIn() {
  signingIn ||= signInOnce().finally(() => {
    signingIn = null;
  });
  return signingIn;
}

async function signInOnce() {
  const server = await serverOrigin();
  const loopback = prepareLoopbackOAuth();
  if (!loopback || !loopback.redirectUri) {
    throw new AuthError("unreachable", "OAuth loopback server is unavailable on this device");
  }
  const client = await registerClient(server, loopback.redirectUri);
  const verifier = random(32);
  const state = random(16);
  const url = new URL(`${server}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: client.redirect_uri,
    state,
    code_challenge: await s256(verifier),
    code_challenge_method: "S256",
    scope: "spacesheep:read spacesheep:write",
  }).toString();

  let answer;
  try {
    answer = await waitForLoopbackOAuth(loopback.id, url.href);
  } catch (e) {
    throw new AuthError("cancelled", String((e && e.message) || e));
  }
  const back = new URL(answer);
  if (back.searchParams.get("state") !== state) {
    throw new AuthError("cancelled", "the sign-in answered for another request");
  }
  const error = back.searchParams.get("error");
  if (error) throw new AuthError("denied", back.searchParams.get("error_description") || error);
  const code = back.searchParams.get("code");
  if (!code) throw new AuthError("cancelled", "the sign-in came back without a code");

  const tokens = await tokenRequest(server, {
    grant_type: "authorization_code",
    code,
    redirect_uri: client.redirect_uri,
    client_id: client.client_id,
    code_verifier: verifier,
  });
  return keep(server, client.client_id, tokens);
}

let refreshing = null;
function refresh(auth) {
  refreshing ||= tokenRequest(auth.server, {
    grant_type: "refresh_token",
    refresh_token: auth.refresh_token,
    client_id: auth.client_id,
  })
    .then((tokens) => keep(auth.server, auth.client_id, tokens))
    .catch(async (e) => {
      if (e.code === "revoked") await extension.storage.local.remove(["auth", "account"]);
      throw e;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function bearer({ interactive = false, force = false } = {}) {
  const server = await serverOrigin();
  const { auth } = await extension.storage.local.get("auth");
  if (auth && auth.kind === "key") {
    if (force) {
      await extension.storage.local.remove(["auth", "account"]);
      return null;
    }
    return auth.key;
  }
  if (auth && auth.server === server) {
    if (!force && auth.access_token && auth.expires_at > Date.now() + 60_000) return auth.access_token;
    if (auth.refresh_token) {
      try {
        return (await refresh(auth)).access_token;
      } catch (e) {
        if (e.code !== "revoked") throw e;
      }
    }
  }
  if (!interactive) return null;
  return (await signIn()).access_token;
}

export async function isConnected() {
  const server = await serverOrigin();
  const { auth } = await extension.storage.local.get("auth");
  return !!auth && (auth.kind === "key" || (auth.server === server && !!auth.refresh_token));
}

export async function saveApiKey(rawKey, handle = null) {
  const cleaned = String(rawKey || "").trim();
  if (!cleaned.startsWith("ss_")) {
    throw new AuthError("invalid_key", "API keys start with ss_");
  }
  await extension.storage.local.set({ auth: { kind: "key", key: cleaned } });
  if (handle) {
    await extension.storage.local.set({ account: { handle: String(handle).replace(/^@/, "") } });
  }
}

export async function signOut() {
  const { auth } = await extension.storage.local.get("auth");
  await extension.storage.local.remove(["auth", "account"]);
  if (auth && auth.kind === "oauth" && auth.refresh_token) {
    await nativeFetch(`${auth.server}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: auth.refresh_token, client_id: auth.client_id }).toString(),
    }).catch(() => {});
  }
}

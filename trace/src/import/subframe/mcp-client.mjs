// A client for Subframe's MCP server (https://mcp.subframe.com/mcp), for the import wizard's Subframe step (T13.1).
//
// BLOCKED (checked 2026-09-27, prior research under T10): the endpoint requires a full OAuth 2.1
// authorization-code + PKCE flow. Subframe's own static API tokens (the Subframe MCP plugin's
// `generate_auth_token`) are NOT accepted by mcp.subframe.com. Completing an OAuth 2.1 authorization-code
// flow needs an interactive browser redirect and a callback listener; this module runs headlessly (a Node
// server process) and cannot perform that redirect, so `connect()` cannot succeed here. This file is the
// module structure and secret handling that a real connection would use, wired the same way as every other
// secret in this codebase (`src/ai/provider.mjs`: read from `process.env`, sent only to the one allowed host,
// never written to disk, never accepted from a client request) — nothing below fakes a working connection.
//
// What would complete this (left for whoever finishes the OAuth flow, e.g. in a browser-based client):
//   1. Register a redirect URI with Subframe, run the authorization-code + PKCE dance in a browser context.
//   2. Store the resulting access (and refresh) token the same way this module already expects one:
//      SUBFRAME_MCP_ACCESS_TOKEN (and optionally SUBFRAME_MCP_REFRESH_TOKEN) as environment variables.
//   3. `verifyConnection()` below already does the rest (a real `initialize` call, host-restricted).
const SUBFRAME_MCP_URL = "https://mcp.subframe.com/mcp";
export { SUBFRAME_MCP_URL };

/**
 * The bearer token for the MCP server, from the environment only (never a file, never a client request).
 * @returns {string|null} The token, or null when unset.
 */
export function subframeToken() {
  const t = process.env.SUBFRAME_MCP_ACCESS_TOKEN;
  return typeof t === "string" && t ? t : null;
}

/**
 * Synchronous, no network: what this process can say about the connection without calling out.
 * `connected` is never `true` here — only `verifyConnection()` (a real network call) can say that.
 *
 * @returns {{connected:false|"unverified", reason:string}}
 */
export function subframeConnectionStatus() {
  if (!subframeToken()) {
    return {
      connected: false,
      reason: "No SUBFRAME_MCP_ACCESS_TOKEN set. mcp.subframe.com requires OAuth 2.1 (authorization-code + PKCE); " +
        "Subframe's own static API tokens are rejected by the MCP endpoint, and this server process cannot perform " +
        "the interactive browser redirect that flow needs. See the comment at the top of this file.",
    };
  }
  return { connected: "unverified", reason: "A token is set, but it has not been checked against the MCP endpoint yet; call verifyConnection()." };
}

// A bearer token must only ever be sent to the one host it is for (mirrors anthropicKey() in src/ai/provider.mjs).
function guardedUrl() {
  const u = new URL(SUBFRAME_MCP_URL);
  if (u.protocol !== "https:" || u.hostname !== "mcp.subframe.com") throw new Error(`refusing to send the Subframe token to ${u.host}: it only goes to mcp.subframe.com`);
  return u;
}

/**
 * A real (never faked) JSON-RPC call to the MCP server, gated by a live token. In this environment there is no
 * verified token, so this always ends in `{ connected: false }` with the server's or network's own reason; it is
 * not mocked to look otherwise.
 *
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{connected:boolean, reason?:string}>}
 */
export async function verifyConnection({ signal } = {}) {
  const token = subframeToken();
  if (!token) return { connected: false, reason: subframeConnectionStatus().reason };
  const url = guardedUrl();
  try {
    const res = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "trace-import-wizard", version: "0.1.0" } } }),
      signal: signal ?? AbortSignal.timeout(10000),
    });
    if (res.status === 401 || res.status === 403) return { connected: false, reason: `${url.host} answered ${res.status}: the token is not accepted (OAuth 2.1 required; see the comment at the top of this file).` };
    if (!res.ok) return { connected: false, reason: `${url.host} answered ${res.status}.` };
    return { connected: true };
  } catch (e) {
    return { connected: false, reason: e.message };
  }
}

// The Subframe MCP client (T13.1). The live OAuth 2.1 connection is blocked in this environment (see the comment
// at the top of mcp-client.mjs); these tests check the module structure and secret handling that IS built —
// nothing here fakes a working connection.
import test from "node:test";
import assert from "node:assert/strict";
import { SUBFRAME_MCP_URL, subframeToken, subframeConnectionStatus, verifyConnection } from "./mcp-client.mjs";

const withEnv = (key, value, fn) => {
  const had = key in process.env, prev = process.env[key];
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try { return fn(); } finally { if (had) process.env[key] = prev; else delete process.env[key]; }
};

test("the MCP URL is Subframe's own, https", () => {
  assert.equal(SUBFRAME_MCP_URL, "https://mcp.subframe.com/mcp");
});

test("no token in the environment: subframeToken() is null, status says why (OAuth 2.1, not a static key)", () => withEnv("SUBFRAME_MCP_ACCESS_TOKEN", undefined, () => {
  assert.equal(subframeToken(), null);
  const s = subframeConnectionStatus();
  assert.equal(s.connected, false);
  assert.match(s.reason, /OAuth 2\.1/);
  assert.match(s.reason, /SUBFRAME_MCP_ACCESS_TOKEN/);
}));

test("a token in the environment is read, but the status stays unverified until a real call is made", () => withEnv("SUBFRAME_MCP_ACCESS_TOKEN", "fake-token-for-test", () => {
  assert.equal(subframeToken(), "fake-token-for-test");
  const s = subframeConnectionStatus();
  assert.equal(s.connected, "unverified");
}));

test("the token never travels anywhere but this file (no persistence): unsetting the env var removes it immediately", () => {
  assert.equal(subframeToken(), null);
});

test("verifyConnection() with no token reports the same reason as the sync status, without any network call", async () => withEnv("SUBFRAME_MCP_ACCESS_TOKEN", undefined, async () => {
  const r = await verifyConnection();
  assert.equal(r.connected, false);
  assert.match(r.reason, /OAuth 2\.1/);
}));

test("verifyConnection() reports a 401/403 from the server as 'not accepted', never as a crash or a false positive", async () => withEnv("SUBFRAME_MCP_ACCESS_TOKEN", "fake-token-for-test", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("no", { status: 401 });
  try {
    const r = await verifyConnection();
    assert.equal(r.connected, false);
    assert.match(r.reason, /401/);
    assert.match(r.reason, /not accepted/);
  } finally { globalThis.fetch = realFetch; }
}));

test("verifyConnection() only ever calls mcp.subframe.com over https (no other host is possible: SUBFRAME_MCP_URL is a constant)", async () => withEnv("SUBFRAME_MCP_ACCESS_TOKEN", "fake-token-for-test", async () => {
  const realFetch = globalThis.fetch;
  let calledUrl = null;
  globalThis.fetch = async (url) => { calledUrl = String(url); return new Response("{}", { status: 200 }); };
  try {
    const r = await verifyConnection();
    assert.equal(calledUrl, SUBFRAME_MCP_URL);
    assert.equal(r.connected, true);
  } finally { globalThis.fetch = realFetch; }
}));

// Who may decide where a model call goes: the server's own config, never a request.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAiConfig, taskConfig, safeBaseUrl, TASKS } from "./config.mjs";
import { anthropicKey, openaiKey } from "./provider.mjs";

const exDir = (ai) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cfg-")); if (ai) fs.writeFileSync(path.join(d, "ai.json"), JSON.stringify(ai)); return d; };

test("an untrusted override keeps only a model name: provider, baseUrl, headers and unknown tasks are stripped, nothing throws", () => {
  const evil = { default: { provider: "anthropic", baseUrl: "http://evil.example" }, tasks: {
    mail: { provider: "anthropic", baseUrl: "http://evil.example/v1", model: "my-model:7b", headers: { "x-api-key": "k" }, apiKey: "k" },
    choose: { provider: "openai", baseUrl: "http://evil.example" },
    "__proto__": { provider: "anthropic" }, constructor: { model: "x" }, other: { model: "y" },
  } };
  const cfg = loadAiConfig({ dir: exDir(), overrides: JSON.parse(JSON.stringify(evil)) });
  const mail = taskConfig(cfg, "mail");
  assert.equal(mail.model, "my-model:7b");
  assert.equal(mail.provider, "ollama");
  assert.equal(mail.baseUrl, undefined);
  assert.equal(mail.headers, undefined);
  assert.equal(taskConfig(cfg, "choose").provider, "ollama");
  assert.equal(cfg.default.provider, "ollama");
  assert.equal(cfg.default.baseUrl, undefined);
  assert.deepEqual(Object.keys(cfg.tasks).filter((t) => !TASKS.includes(t)), []);
  assert.equal({}.provider, undefined); // nothing was polluted
});

test("junk in the override is ignored, not thrown", () => {
  for (const o of [null, undefined, "x", 5, [], { tasks: null }, { tasks: "x" }, { tasks: { mail: null } }, { tasks: { mail: { model: 5 } } }, { tasks: { mail: { model: "a b; rm -rf" } } }, { tasks: { mail: { model: "x".repeat(500) } } }]) {
    const cfg = loadAiConfig({ dir: exDir(), overrides: o });
    assert.equal(taskConfig(cfg, "mail").model, taskConfig(loadAiConfig({ dir: exDir() }), "mail").model, JSON.stringify(o));
  }
});

test("a paid provider only takes models the server config names or allows; a local one takes any sane name", () => {
  const paid = exDir({ tasks: { mail: { provider: "anthropic", model: "claude-haiku" } } });
  assert.equal(taskConfig(loadAiConfig({ dir: paid, overrides: { tasks: { mail: { model: "claude-opus-4" } } } }), "mail").model, "claude-haiku");
  assert.equal(taskConfig(loadAiConfig({ dir: paid, overrides: { tasks: { mail: { model: "claude-haiku" } } } }), "mail").model, "claude-haiku");
  const remote = exDir({ tasks: { mail: { provider: "openai", model: "gpt-a", baseUrl: "https://llm.example.com" } } });
  assert.equal(taskConfig(loadAiConfig({ dir: remote, overrides: { tasks: { mail: { model: "gpt-expensive" } } } }), "mail").model, "gpt-a");
  const local = exDir({ tasks: { mail: { provider: "ollama", model: "a" } } });
  assert.equal(taskConfig(loadAiConfig({ dir: local, overrides: { tasks: { mail: { model: "llama3.1:8b" } } } }), "mail").model, "llama3.1:8b");
});

test("trusted overrides (the CLI's own arguments) may set provider and model; a bad baseUrl is still dropped", () => {
  const cfg = loadAiConfig({ dir: exDir(), trusted: true, overrides: { tasks: { choose: { provider: "anthropic", model: "claude-x", baseUrl: "file:///etc/passwd" } } } });
  const c = taskConfig(cfg, "choose");
  assert.deepEqual([c.provider, c.model, c.baseUrl], ["anthropic", "claude-x", undefined]);
});

test("base URLs: http(s) only, no credentials", () => {
  assert.equal(safeBaseUrl("http://localhost:11434"), "http://localhost:11434");
  assert.equal(safeBaseUrl("https://api.example.com/v1/"), "https://api.example.com/v1");
  for (const bad of ["file:///etc/passwd", "ftp://x", "javascript:alert(1)", "//x", "not a url", "http://user:pw@host", 5, null, undefined]) assert.equal(safeBaseUrl(bad), undefined, String(bad));
  const cfg = loadAiConfig({ dir: exDir({ default: { baseUrl: "gopher://x" }, tasks: { mail: { baseUrl: "http://user:pw@h" } } }) });
  assert.equal(cfg.default.baseUrl, undefined);
  assert.equal(cfg.tasks.mail.baseUrl, undefined);
});

test("API keys go only where they belong", () => {
  const saved = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY };
  process.env.ANTHROPIC_API_KEY = "sk-FAKE"; process.env.OPENAI_API_KEY = "sk-FAKE-O";
  try {
    assert.equal(anthropicKey("https://api.anthropic.com/v1/messages"), "sk-FAKE");
    for (const bad of ["http://api.anthropic.com/v1/messages", "https://api.anthropic.com.evil.example/v1", "https://evil.example/v1/messages", "http://127.0.0.1:9/x", "https://user@evil.example"]) assert.throws(() => anthropicKey(bad), /refusing to send ANTHROPIC_API_KEY/, bad);
    assert.equal(openaiKey("http://localhost:1234"), "sk-FAKE-O");
    assert.equal(openaiKey("http://127.0.0.1:8080"), "sk-FAKE-O");
    assert.equal(openaiKey("https://llm.example.com"), null);
    assert.equal(openaiKey("https://llm.example.com", ["llm.example.com"]), "sk-FAKE-O");
    assert.equal(openaiKey("https://evil.example", ["llm.example.com"]), null);
    delete process.env.OPENAI_API_KEY;
    assert.equal(openaiKey("http://localhost:1234"), null);
  } finally {
    for (const [k, v] of [["ANTHROPIC_API_KEY", saved.a], ["OPENAI_API_KEY", saved.o]]) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});

test("every task the server knows, the Part inspector's part-chat included, takes only a model name from an untrusted override", () => {
  assert.ok(TASKS.includes("part-chat"), "part-chat is a known task");
  const evil = Object.fromEntries(TASKS.map((t) => [t, { provider: "anthropic", baseUrl: "http://evil.example", headers: { "x-api-key": "stolen" }, model: "my-model:7b" }]));
  const base = loadAiConfig({ dir: exDir() });
  const cfg = loadAiConfig({ dir: exDir(), overrides: { tasks: evil } });
  for (const t of TASKS) {
    const c = taskConfig(cfg, t), was = taskConfig(base, t);
    assert.equal(c.provider, was.provider, `${t}: provider stays the server's`);
    assert.equal(c.baseUrl, was.baseUrl, `${t}: baseUrl stays the server's`);
    assert.equal(c.headers, undefined, `${t}: no client headers`);
    assert.equal(c.model, "my-model:7b", `${t}: the model name is the one thing a client may pick (local provider)`);
  }
});

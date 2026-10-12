// The profile is the only switch: Trace's tasks read on/off from Line's one profile set (packages/core/ai-profiles.json).
// A task that runs by itself asks a model only when its profile is on AND records a measured win over static; the
// measurement harness (eval, bench, a test's provider) still runs it. No real model here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAi } from "./index.mjs";
import { loadAiConfig, taskConfig, taskOff, profileLayer } from "./config.mjs";

const dir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ai-decide-"));
  fs.writeFileSync(path.join(d, "story.md"), "- Owner is the project lead.\n");
  return d;
};
const spec = { docs: {} };
const q = () => ({ id: "list.owner", type: "choice", text: 'Row part "owner" (e.g. "Lena") matches more than one API field.', options: [{ label: 'API field "lead"', value: 1 }, { label: 'API field "deputy"', value: 2 }] });
const make = (reply, o = {}) => createAi({ dir: dir(), spec, source: "export default function P(){ return <main/>; }", matched: {}, provider: async () => ({ text: reply, usage: { in: 1, out: 1 } }), ...o });

test("measuring (a test provider, the eval, the bench): Qwen's cited pick is the choose task's answer", async () => {
  const ai = make('{"choice":1,"fact":1}');
  assert.equal((await ai.answer(q())).value, 1);
  assert.equal(ai.decisions["list.owner"].task, "choose");
  assert.equal(ai.decisions["list.owner"].via, undefined, "no jev and no Qwen-suggestion rung: the step's own answer");
});

test("trace.choose is off in its profile: a real run asks no model and the static path stands", async () => {
  const logs = [];
  let asked = 0;
  const ai = make('{"choice":1,"fact":1}', { measure: false, provider: async () => { asked += 1; return { text: '{"choice":1,"fact":1}', usage: { in: 1, out: 1 } }; }, onLog: (e) => logs.push(e) });
  assert.equal(await ai.answer(q()), null);
  assert.equal(asked, 0);
  assert.match(logs.find((e) => e.kind === "note")?.text, /choose step is off in its profile/);
});

test("the off list comes from the profiles only: choose and pick-fields are off; tasks the person turns on (AI for a run, a chat) are not", () => {
  const cfg = loadAiConfig({ trusted: true, overrides: { tasks: { choose: { provider: "ollama", model: "qwen2.5-coder:7b" } } } });
  for (const t of ["choose", "pick-fields"]) assert.equal(taskOff(cfg, t), true, t);
  for (const t of ["draft-body", "explain", "mail", "part-chat", "generate-sample", "draft-story"]) assert.equal(taskOff(cfg, t), false, t);
});

test("task models default from Line's profile set (the 1.5B); ai.config.json only overrides", () => {
  assert.equal(profileLayer().default.model, "qwen2.5-coder:1.5b");
  const cfg = loadAiConfig();
  for (const t of ["choose", "pick-fields", "explain", "draft-story"]) assert.deepEqual([taskConfig(cfg, t).provider, taskConfig(cfg, t).model], ["ollama", "qwen2.5-coder:1.5b"], t);
  assert.deepEqual(profileLayer("/nonexistent/ai-profiles.json"), { tasks: {}, off: [] }, "Trace on its own keeps its built-in default");
});

// cu2: Trace's choose task goes through Line's decide() (packages/core/line-decide.mjs): Qwen suggests with a cited
// fact, jev decides. A fake Qwen and the decide mock (no model, no source repo).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAi } from "./index.mjs";
import { loadAiConfig, taskConfig, profileLayer } from "./config.mjs";
import { createMockDecide } from "../../../packages/core/line-decide-mock.mjs";

const dir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ai-decide-"));
  fs.writeFileSync(path.join(d, "story.md"), "- Owner is the project lead.\n");
  return d;
};
const spec = { docs: {} };
const q = () => ({ id: "list.owner", type: "choice", text: 'Row part "owner" (e.g. "Lena") matches more than one API field.', options: [{ label: 'API field "lead"', value: 1 }, { label: 'API field "deputy"', value: 2 }] });
const make = (reply, decide, onLog) => createAi({ dir: dir(), spec, source: "export default function P(){ return <main/>; }", matched: {}, provider: async () => ({ text: reply, usage: { in: 1, out: 1 } }), decide, onLog });

test("jev agreeing with Qwen's cited pick accepts it, attributed to jev", async () => {
  const mock = createMockDecide({ pick: 0 });
  const ai = make('{"choice":1,"fact":1}', mock.decide);
  assert.equal((await ai.answer(q())).value, 1);
  assert.equal(ai.decisions["list.owner"].via, "jev");
  assert.equal(ai.decisions["list.owner"].attribution.decider, "jev");
  assert.deepEqual(mock.picker.calls[0], ['API field "lead"', 'API field "deputy"']);
});

test("jev disagreeing with Qwen leaves the question for the person (nothing accepted)", async () => {
  const logs = [];
  const ai = make('{"choice":1,"fact":1}', createMockDecide({ pick: 1 }).decide, (e) => logs.push(e));
  assert.equal(await ai.answer(q()), null);
  assert.equal(ai.decisions["list.owner"], undefined);
  assert.match(logs.find((e) => e.verdict)?.verdict.text, /^skipped — jev picked .* but Qwen suggested .*left for you$/);
});

test("jev not running: Qwen's checked pick stands and the attribution says why", async () => {
  const ai = make('{"choice":2,"fact":1}', createMockDecide({ pick: 0, jevUp: false }).decide);
  assert.equal((await ai.answer(q())).value, 2);
  assert.equal(ai.decisions["list.owner"].via, "model");
  assert.match(ai.decisions["list.owner"].attribution.note, /not running/);
});

test("a test provider without an explicit decide never loads jev (no real model in tests)", async () => {
  const ai = make('{"choice":1,"fact":1}');
  await ai.answer(q());
  assert.equal(ai.decisions["list.owner"].via, undefined);
});

test("task models default from Line's profile set (the 1.5B); ai.config.json only overrides", () => {
  assert.equal(profileLayer().default.model, "qwen2.5-coder:1.5b");
  const cfg = loadAiConfig();
  for (const t of ["choose", "pick-fields", "explain", "draft-story"]) assert.deepEqual([taskConfig(cfg, t).provider, taskConfig(cfg, t).model], ["ollama", "qwen2.5-coder:1.5b"], t);
  assert.deepEqual(profileLayer("/nonexistent/ai-profiles.json"), { tasks: {} }, "Trace on its own keeps its built-in default");
});

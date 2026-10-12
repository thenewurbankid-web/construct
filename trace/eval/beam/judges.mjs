// The ONE module every Opus call of the planner eval goes through (#896). It renders the judge's system prompt from
// its versioned file, builds nothing itself (inputs come from inputs.mjs), calls Construct's LLM layer
// (packages/core/llm.mjs callLlm, provider "claude", model "opus") and records a transcript per call:
//
//   <runsDir>/<setup>/<itemId>/<step>.json
//     { step, role, promptFile, promptVersion, promptSha, rubricFile?, rubricVersion?, rubricSha?, model, temperature,
//       temperatureEnforced, input, output, parsed, problems, at, mode }
//
// Modes: "live" calls Opus; "replay" reads recorded transcripts (the committed fixtures, or an earlier live run) and
// never calls a model; "fake" takes an injected llm(system, prompt) function and records like live (tests and the
// fixture recorder). The model is fixed to "opus"; anything else (and "fable" above all) is refused.
//
// Temperature: Opus 5.5 takes no sampling parameters and the claude CLI has no flag, so `temperature` is null (model
// default, the same on every call) and `temperatureEnforced: false` says nothing was set. Replay is what makes runs repeatable.
import fs from "node:fs";
import path from "node:path";
import { callLlm, stripCodeFence } from "../../../packages/core/llm.mjs";
import { loadPrompt, loadRubric, fillTemplate, setupId, PROMPTS_DIR, BEAM_DIR } from "./prompts.mjs";
import { closedSetPlaceholders, checkGold } from "./gold.mjs";
import { assertGraderInputClean } from "./inputs.mjs";

export const MODEL = "opus";
// Opus 5.5 rejects sampling parameters (temperature/top_p) and the claude CLI has no flag for them: the temperature is
// fixed at the model default. Recorded as null with temperatureEnforced:false so a later API provider can set it.
export const TEMPERATURE = null;

/** Throws unless the model is exactly "opus" (the owner's rule: never fable, never a silent default). */
export function assertModel(model) {
  if (/fable/i.test(String(model))) throw new Error("the planner eval never uses the fable model");
  if (model !== MODEL) throw new Error(`the planner eval's judges run on "${MODEL}", not "${model}"`);
}

/** The first JSON object in a model reply (code fences and stray prose tolerated). */
export function parseJsonReply(text) {
  const s = stripCodeFence(String(text ?? ""));
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* fall through */ } }
  return null;
}

/**
 * A grader reply checked against the rubric: every line an integer in 0..max, a one-line justification.
 * @param {any} reply
 * @param {{id: string, max: number}[]} lines
 */
export function checkGrade(reply, lines) {
  const problems = [];
  const scores = {};
  for (const l of lines) {
    const v = reply?.scores?.[l.id];
    if (Number.isInteger(v) && v >= 0 && v <= l.max) scores[l.id] = v;
    else { scores[l.id] = null; problems.push(`${l.id}: ${JSON.stringify(v)} is not an integer 0..${l.max}`); }
  }
  const justification = String(reply?.justification ?? "").split("\n")[0].trim().slice(0, 240);
  if (!justification) problems.push("no justification");
  return { scores, justification, problems };
}

const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n"); };

/**
 * @param {{
 *   mode: "live"|"replay"|"fake",
 *   requester: string, grader: string, rubric?: string,
 *   runsDir: string,                 where transcripts are written (live, fake)
 *   replayDirs?: string[],           where transcripts are read from (replay), first hit wins
 *   llm?: (system: string, prompt: string, meta: {step: string, role: string}) => string|Promise<string>,  fake mode
 *   promptsDir?: string, model?: string, now?: () => string,
 * }} opts
 */
export function createJudges(opts) {
  const { mode, runsDir, replayDirs = [], llm, promptsDir = PROMPTS_DIR, now = () => new Date().toISOString() } = opts;
  const model = opts.model ?? MODEL;
  assertModel(model);
  if (!["live", "replay", "fake"].includes(mode)) throw new Error(`unknown judge mode "${mode}"`);
  if (mode === "fake" && typeof llm !== "function") throw new Error("fake mode needs an llm function");
  const requesterP = loadPrompt("requester", opts.requester, promptsDir);
  const graderP = loadPrompt("grader", opts.grader, promptsDir);
  // The grader prompt embeds the rubric, so a grader version pins its rubric version (front matter `rubric:`).
  const rubric = loadRubric(opts.rubric ?? graderP.meta.rubric, promptsDir);
  const setup = setupId(requesterP.version, graderP.version);
  const requesterSystem = fillTemplate(requesterP.body, closedSetPlaceholders());
  const graderSystem = fillTemplate(graderP.body, { RUBRIC: rubric.body.trim() });
  let calls = 0;

  async function call(itemId, step, role, prompt, system, input, extra = {}) {
    const file = path.join(runsDir, setup, itemId, `${step}.json`);
    if (mode === "replay") {
      const hit = replayDirs.map((d) => path.join(d, setup, itemId, `${step}.json`)).find((p) => fs.existsSync(p));
      if (!hit) throw new Error(`no recorded transcript for ${setup}/${itemId}/${step} (replay mode never calls a model; record it with a live run)`);
      const t = JSON.parse(fs.readFileSync(hit, "utf8"));
      if (t.promptVersion !== prompt.version) throw new Error(`transcript ${setup}/${itemId}/${step} was recorded with ${role} ${t.promptVersion}, this setup asks ${prompt.version}`);
      return { output: t.output, transcript: { ...t, replayedFrom: path.relative(BEAM_DIR, hit), inputDrift: JSON.stringify(t.input) !== JSON.stringify(input) } };
    }
    const userPrompt = `Input:\n${JSON.stringify(input, null, 2)}\n`;
    calls++;
    const output = mode === "fake" ? await llm(system, userPrompt, { step, role }) : await callLlm("claude", userPrompt, { model, systemPrompt: system });
    const transcript = {
      step, role,
      promptFile: prompt.file, promptVersion: prompt.version, promptSha: prompt.sha,
      ...extra,
      model, temperature: TEMPERATURE, temperatureEnforced: false,
      input, output: String(output), at: now(), mode,
    };
    writeJson(file, transcript);
    return { output: String(output), transcript };
  }

  return {
    setup,
    versions: { requester: requesterP.version, grader: graderP.version, rubric: rubric.version },
    rubric,
    get calls() { return calls; },

    /** Requester "write": requirement + private notes + gold. */
    async requesterWrite(itemId, input) {
      if (input.task !== "write") throw new Error("requesterWrite takes a write input (inputs.mjs buildRequesterWriteInput)");
      const { output, transcript } = await call(itemId, "requester-write", "requester", requesterP, requesterSystem, input);
      const reply = parseJsonReply(output);
      const g = checkGold(reply?.gold);
      return {
        requirement: String(reply?.requirement ?? "").trim(),
        notes: String(reply?.notes ?? "").trim(),
        gold: g.gold,
        goldProblems: g.problems,
        transcript: summarize(transcript),
      };
    },

    /** Requester "answer": the owner's answer to the planner's question. */
    async requesterAnswer(itemId, input) {
      if (input.task !== "answer" || "gold" in input) throw new Error("requesterAnswer takes an answer input without gold (inputs.mjs buildRequesterAnswerInput)");
      const { output, transcript } = await call(itemId, "requester-answer", "requester", requesterP, requesterSystem, input);
      const reply = parseJsonReply(output);
      return { answer: String(reply?.answer ?? "").trim(), option: reply?.option ?? null, transcript: summarize(transcript) };
    },

    /** Grader: one run, blind. */
    async gradeRun(itemId, input, item) {
      assertGraderInputClean(input, item);
      const { output, transcript } = await call(itemId, `grader-${input.run.id}`, "grader", graderP, graderSystem, input, { rubricFile: rubric.file, rubricVersion: rubric.version, rubricSha: rubric.sha });
      const g = checkGrade(parseJsonReply(output), rubric.lines);
      return { ...g, transcript: summarize(transcript) };
    },
  };
}

/** What an item keeps of a transcript (the full one stays on disk). */
function summarize(t) {
  const { input, output, ...rest } = t;
  return rest;
}

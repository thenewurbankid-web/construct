// Small-model isolation harness: every model, sampling setting, prompt, edit format and arm lives here,
// so a new arm is one entry in `arms` (plus a strategy in run.mjs if it needs a new control flow).
// Issue #941. Runs outside Line/Construct's plan API on purpose.

export const ollama = { url: 'http://127.0.0.1:11434', keepAlive: '15m', timeoutMs: 600_000 };

export const models = {
  coder: 'qwen2.5-coder:1.5b',
  driver: 'qwen2.5-coder:7b',
};

// Named sampling presets (Ollama `options`).
export const sampling = {
  greedy: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 2048 },
  // Qwen2.5-Coder's own generation_config (RESEARCH.md). Arm E gives each sample its own seed (seedBase + i).
  qwen: { temperature: 0.7, top_p: 0.8, top_k: 20, repeat_penalty: 1.1, num_ctx: 4096, num_predict: 2048 },
  // FIM fill: greedy, shorter cap (a body, not a file).
  fim: { temperature: 0, seed: 42, num_ctx: 4096, num_predict: 1024 },
};

// r2 rule: every worker (1.5b) call is fresh, single-turn, and its prompt stays at or under this many tokens.
// Context files are shown as signatures only (exact prop types inlined, bodies elided) and dropped if still over.
export const workerBudgetTokens = 1500;
export const approxTokens = (s) => Math.ceil(s.length / 3.2);

const fence = (path, body) => `File ${path}:\n\`\`\`${path.endsWith('.tsx') ? 'tsx' : 'ts'}\n${body.replace(/\n$/, '')}\n\`\`\``;
const contextBlock = (files) => files.length
  ? `Read-only context (do not change these):\n\n${files.map((f) => fence(f.path, f.body)).join('\n\n')}\n\n`
  : '';
const taskBlock = (task) => `Task: ${task.goal}\n\nSpec excerpt (SPEC.md):\n${task.spec}\n\n`;

export const prompts = {
  coderSystem: 'You are a TypeScript and React developer. You edit exactly one file. Reply with the complete new contents of that file in a single fenced code block and nothing else.',

  // Arms A and D: the coder reads the task, the spec excerpt and the file itself.
  direct: ({ task, target, context }) =>
    `${taskBlock(task)}${contextBlock(context)}File to edit:\n${fence(target.path, target.body)}\n\nReply with the complete new ${target.path} in one fenced code block.`,

  driverSystem: 'You are a senior React and TypeScript developer directing a junior coding model that edits one file. '
    + 'Write a short, concrete instruction for it: say exactly what to change and where, and include a small code example of the exact JSX/TypeScript to write, using the real names from the file. '
    + 'Keep it under 15 lines. Do not write the whole file.',

  // Arm B/C driver: reads the same material as the direct coder, writes an instruction.
  driver: ({ task, target, context }) =>
    `${taskBlock(task)}${contextBlock(context)}The file the junior will edit:\n${fence(target.path, target.body)}\n\nWrite the instruction for the junior.`,

  // Arm C: the driver re-instructs after a failed attempt.
  driverRepair: ({ task, target, context, instruction, attemptBody, errors }) =>
    `${taskBlock(task)}${contextBlock(context)}Original file:\n${fence(target.path, target.body)}\n\n`
    + `Your previous instruction:\n${instruction}\n\n`
    + (attemptBody != null ? `The junior's result:\n${fence(target.path, attemptBody)}\n\n` : 'The junior did not return a usable file.\n\n')
    + `It failed these checks:\n${errors}\n\nWrite a corrected instruction for the junior (same rules: short, concrete, with a code example). The junior will edit ${attemptBody != null ? 'its own result above' : 'the original file'}.`,

  // Arm B/C coder: the instruction replaces the spec (the coder does not see SPEC.md).
  driven: ({ instruction, target, context }) =>
    `Instruction from your lead:\n${instruction}\n\n${contextBlock(context)}File to edit:\n${fence(target.path, target.body)}\n\nApply the instruction. Reply with the complete new ${target.path} in one fenced code block.`,
};

// Edit formats: how a reply becomes a file. `whole-file` = the longest fenced block is the new file.
export const editFormats = {
  'whole-file': {
    parse(reply) {
      const blocks = [...reply.matchAll(/```[\w.+-]*[ \t]*\n([\s\S]*?)```/g)].map((m) => m[1]);
      if (!blocks.length) return { ok: false, detail: /```/.test(reply) ? 'unclosed code fence' : 'no code fence' };
      const body = blocks.reduce((a, b) => (b.length > a.length ? b : a));
      if (!body.trim()) return { ok: false, detail: 'empty code block' };
      return { ok: true, body: body.endsWith('\n') ? body : body + '\n' };
    },
  },
};

// Arms. strategy: 'direct' (one model writes the file) | 'driven' (driver instructs, coder edits; `repairs` > 0 adds the loop).
export const arms = {
  A: { label: '1.5b alone', strategy: 'direct', model: 'coder', sampling: 'greedy', editFormat: 'whole-file' },
  B: { label: '7b driver -> 1.5b', strategy: 'driven', driver: 'driver', coder: 'coder', sampling: 'greedy', editFormat: 'whole-file', repairs: 0 },
  C: { label: '7b driver -> 1.5b + repair x2', strategy: 'driven', driver: 'driver', coder: 'coder', sampling: 'greedy', editFormat: 'whole-file', repairs: 2 },
  D: { label: '7b alone (ceiling)', strategy: 'direct', model: 'driver', sampling: 'greedy', editFormat: 'whole-file' },
};

// Which arms a named run uses.
// ---- r2 arms (research wave, RESEARCH.md). Code is never wrapped in JSON; no native tool calls. ----
Object.assign(arms, {
  // Best-of-N with tsc (then the task check) as the picker. Same driver brief as B; N samples at Qwen's settings.
  E: { label: '7b brief -> 1.5b best-of-5 (tsc+check picker)', strategy: 'bestOfN', driver: 'driver', coder: 'coder',
    driverSampling: 'greedy', sampling: 'qwen', n: 5, seedBase: 1, editFormat: 'whole-file', coderContext: 'signatures', reportN: [1, 3, 5] },
  // Whole-function splice with a code-shaped brief: 1.5b returns only the declaration(s); the harness splices by name.
  F: { label: '7b code-shaped brief -> 1.5b function, spliced', strategy: 'codeShaped', driver: 'driver', coder: 'coder',
    sampling: 'greedy', editFormat: 'splice', coderContext: 'signatures' },
  // Same brief, output as SEARCH/REPLACE blocks (never unified diffs).
  'F-sr': { label: '7b code-shaped brief -> 1.5b search/replace', strategy: 'codeShaped', driver: 'driver', coder: 'coder',
    sampling: 'greedy', editFormat: 'search-replace', coderContext: 'signatures' },
  // FIM: 7b writes the skeleton with a /*FILL*/ hole, 1.5b fills it via /api/generate prompt+suffix.
  // Only the instruct tag is pulled (no qwen2.5-coder:1.5b-base); its Ollama template has the FIM branch.
  G: { label: '7b skeleton -> 1.5b FIM body (instruct tag)', strategy: 'fim', driver: 'driver', coder: 'coder',
    driverSampling: 'greedy', sampling: 'fim', editFormat: 'fim' },
});

Object.assign(prompts, {
  // F / F-sr driver: a code-shaped brief (CanItEdit's "descriptive" style), the same for both output formats.
  codeShapedSystem: 'You are a senior React and TypeScript developer writing a precise brief for a junior coding model that will edit one file. '
    + 'Use exactly these sections:\n'
    + 'FUNCTION: the exact name of the one top-level function (or constant) to rewrite or add.\n'
    + 'SIGNATURE: its exact signature, with the prop types written out in full.\n'
    + 'IMPORTS: the exact import lines the file needs to add (or "none").\n'
    + 'CHANGE: the lines to change, one bullet each, quoting the exact strings to show.\n'
    + 'EXAMPLE: one short worked code example of the change.\n'
    + 'Under 30 lines. Do not write the whole file.',
  codeShaped: ({ task, target, context }) =>
    `${taskBlock(task)}${contextBlock(context)}The file the junior will edit:\n${fence(target.path, target.body)}\n\nWrite the brief.`,

  // F coder: only the function (plus any imports it needs) comes back.
  splice: ({ instruction, target, context }) =>
    `Brief from your lead:\n${instruction}\n\n${contextBlock(context)}Current file:\n${fence(target.path, target.body)}\n\n`
    + 'Reply with ONLY the new or changed top-level function (and the import lines it needs) in one fenced code block. Do not repeat the rest of the file.',
  // F-sr coder: SEARCH/REPLACE blocks.
  searchReplace: ({ instruction, target, context }) =>
    `Brief from your lead:\n${instruction}\n\n${contextBlock(context)}Current file:\n${fence(target.path, target.body)}\n\n`
    + 'Reply with one or more edit blocks in exactly this format, and nothing else:\n'
    + '<<<<<<< SEARCH\n(lines copied exactly from the current file)\n=======\n(the new lines)\n>>>>>>> REPLACE\n'
    + 'Use one block per place you change. To add imports, search for an existing import line and replace it with itself plus the new lines.',

  // G driver: the skeleton with one hole.
  skeletonSystem: 'You are a senior React and TypeScript developer. Write the complete new version of the file, but leave the body of the main function for a junior to fill: '
    + 'put exactly one line containing /*FILL*/ where the body goes, and directly above it a comment of at most 6 lines saying what the body must do, quoting the exact strings to show. '
    + 'Keep every import (add the ones the body will need), the types, the function signature and any helper constants. Reply with the file in one fenced code block.',
  skeleton: ({ task, target, context }) =>
    `${taskBlock(task)}${contextBlock(context)}Current file:\n${fence(target.path, target.body)}\n\nWrite the skeleton.`,
});

// Edit formats added for r2 (the appliers live in lib/edit.mjs; run.mjs maps these names to them).
editFormats.splice = { kind: 'splice' };
editFormats['search-replace'] = { kind: 'search-replace' };
editFormats.fim = { kind: 'fim' };

// ---- r2: deterministic blocks (blocks/) instead of, or under, a driver model ----
models.toolDriver = 'qwen3:4b';
// Qwen3's published non-thinking settings (T 0.7, top_p 0.8, top_k 20), seeded; thinking off via `think: false`
// plus the documented /no_think switch in the system prompt.
sampling.qwen3 = { temperature: 0.7, top_p: 0.8, top_k: 20, seed: 42, num_ctx: 8192, num_predict: 1024 };

Object.assign(arms, {
  // H: no driver model at all. briefBuilder -> 1.5b (sampler, N up to 5) -> spliceApplier.
  H: { label: 'blocks: briefBuilder -> 1.5b best-of-5 -> splice (no driver)', strategy: 'blocks', coder: 'coder',
    sampling: 'qwen', n: 5, seedBase: 1, editFormat: 'function-splice', reportN: [1, 3, 5] },
  // I: qwen3:4b drives the same blocks through native Ollama tools (brief, code, splice, check, done).
  I: { label: 'qwen3:4b tool-calling driver over the blocks', strategy: 'toolDriver', driver: 'toolDriver', coder: 'coder',
    driverSampling: 'qwen3', think: false, sampling: 'qwen', n: 5, seedBase: 1, maxTurns: 8, repairs: 2, editFormat: 'function-splice' },
});

Object.assign(prompts, {
  functionCoderSystem: 'You are a TypeScript and React developer. Reply with only the one function you are asked for, complete, in a single fenced code block. No imports, no other declarations, no explanation.',
  toolDriverSystem: '/no_think\nYou lead a junior coding model that edits one file. Work only through the tools, one tool call per turn: '
    + 'brief (build the brief; add intent text with the exact strings the spec asks for, or the errors to fix), code (the junior writes the function), '
    + 'splice (put it in the file), check (tsc and the task check), done. The usual order is brief, code, splice, check, done. '
    + 'If code or check fails, call brief again with intent that fixes the problem (at most 2 times), then code, splice, check.',
  toolDriver: ({ task, target }) =>
    `Task: ${task.goal}\n\nSpec excerpt (SPEC.md):\n${task.spec}\n\nFile ${target.path}:\n\`\`\`${target.path.endsWith('.tsx') ? 'tsx' : 'ts'}\n${target.body.replace(/\n$/, '')}\n\`\`\`\n\nStart with the brief tool.`,
});

export const runs = {
  r1: ['A', 'B', 'C', 'D'],
  r2: ['A', 'B', 'E', 'F', 'F-sr', 'G', 'H', 'I'],
};

// Failure classes, first failing stage wins: format (reply did not yield a file) -> fragment (a whole-file reply
// missing exports the original had, i.e. a fragment pasted as the file) -> tsc -> check.
// r1 ran before `fragment` was split out: its fragments are under `format`, with detail "fragment: ...".
export const failureOrder = ['format', 'fragment', 'tsc', 'check'];

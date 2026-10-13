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
};

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
export const runs = {
  r1: ['A', 'B', 'C', 'D'],
};

// Failure classes, first failing stage wins: format (reply did not yield a file) -> tsc -> check.
// `fragment` (a reply missing exports the original file had) is reported inside `format` for r1.
export const failureOrder = ['format', 'tsc', 'check'];

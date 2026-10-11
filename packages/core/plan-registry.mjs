// cu1 -- Construct's commands as @mx/plan's tool registry. @mx/plan's runner sees `{ list(), call(name, args) }`
// (registry.ts `Registry`); this builds that interface over command-registry.mjs, so there is one registry, not two: a
// plan step `construct.validate` runs the same handler `construct validate` runs.
//
//   name     `construct.<command>`, a hyphenated command in camelCase (`check-change` -> `construct.checkChange`).
//   kind     `read` for the commands in READ_COMMANDS, `write` for every other one (a write waits for a person's approval).
//   args     `{ argv?: string[] }`: the words after the command, exactly as typed on the command line.
//   result   `{ command, argv, ok, exitCode, stdout, stderr, json? }`: what the command printed and its exit code. A
//            command that stops with an error (a usage error, a refusal) throws one plain-English sentence, so the
//            plan marks the step failed with it.
//
// Commands run in this process, one at a time, with their output captured. Interactive commands (`repl`, and
// `pipeline`, which reads stdin) are never offered. Contract: packages/line-links/contracts.d.ts (PlanRegistry).

/** Commands that only read: a plan runs them without a person's approval. */
export const READ_COMMANDS = Object.freeze(['validate', 'summarize', 'doctor', 'rules', 'research', 'review', 'decide', 'traces', 'check-change']);
/** Commands a plan step never runs (they wait for keyboard input or end the process). */
export const NEVER_OFFERED = Object.freeze(['repl', 'pipeline']);

/**
 * The tool name for a command.
 * @param {string} command e.g. `check-change`.
 * @returns {string} e.g. `construct.checkChange`.
 */
export function commandToolName(command) {
  return `construct.${command.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())}`;
}

/** The args schema every command tool shares: `{ argv?: string[] }` and nothing else (a SchemaLike, no zod needed). */
export const ARGV_SCHEMA = Object.freeze({
  safeParse(value) {
    const fail = (path, message) => ({ success: /** @type {const} */ (false), error: { issues: [{ path, message }] } });
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail([], 'must be an object like { "argv": ["--format", "json"] }');
    const extra = Object.keys(value).filter((k) => k !== 'argv');
    if (extra.length) return fail([extra[0]], 'is not an argument; put command-line words in argv');
    const argv = value.argv ?? [];
    if (!Array.isArray(argv) || argv.some((a) => typeof a !== 'string')) return fail(['argv'], 'must be a list of strings');
    return { success: /** @type {const} */ (true), data: { argv: [...argv] } };
  },
});

/** @type {Promise<unknown>} */
let queue = Promise.resolve();

/** Run `fn` with stdout, stderr, the exit code and process.exit captured, one run at a time. */
function captured(fn) {
  const run = queue.then(async () => {
    const out = []; const err = [];
    const { stdout, stderr } = process;
    const writeOut = stdout.write; const writeErr = stderr.write;
    const exit = process.exit; const exitCode = process.exitCode;
    const grab = (sink) => (chunk, encoding, cb) => {
      sink.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(typeof encoding === 'string' ? /** @type {BufferEncoding} */ (encoding) : 'utf8'));
      const done = typeof encoding === 'function' ? encoding : cb;
      if (typeof done === 'function') done();
      return true;
    };
    stdout.write = /** @type {any} */ (grab(out));
    stderr.write = /** @type {any} */ (grab(err));
    process.exitCode = undefined;
    process.exit = /** @type {any} */ ((code) => { throw Object.assign(new Error(`The command tried to end the process with code ${code ?? 0}.`), { exitCode: code ?? 0, processExit: true }); });
    try {
      let error = null;
      try { await fn(); } catch (e) { error = e; }
      return { stdout: out.join(''), stderr: err.join(''), exitCode: Number(process.exitCode ?? 0), error };
    } finally {
      stdout.write = writeOut; stderr.write = writeErr; process.exit = exit; process.exitCode = exitCode;
    }
  });
  queue = run.catch(() => {});
  return run;
}

const firstLine = (s) => String(s ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
const asSentence = (s) => { const t = firstLine(s).replace(/\s+/g, ' '); return /[.?!]$/.test(t) ? t : `${t}.`; };

/**
 * @mx/plan's registry over a Construct command registry.
 *
 * @param {{ resolve: (name: string) => any, list: () => any[] }} commands A `createCommandRegistry()` with commands registered.
 * @param {{ only?: string[], read?: readonly string[] }} [options] `only` limits the commands offered; `read` replaces READ_COMMANDS.
 * @returns {import('../line-links/contracts').PlanRegistry}
 *
 * @example
 * const commands = createCommandRegistry(); registerBuiltinCommands(commands);
 * const registry = commandPlanRegistry(commands, { only: ['validate'] });
 * await registry.call('construct.validate', { argv: ['--format', 'json', '--dir', root] });
 */
export function commandPlanRegistry(commands, options = {}) {
  const read = new Set(options.read ?? READ_COMMANDS);
  const offered = () => commands.list().filter((c) => !NEVER_OFFERED.includes(c.name) && (!options.only || options.only.includes(c.name)));
  const specOf = (c) => ({
    name: commandToolName(c.name),
    kind: /** @type {'read' | 'write'} */ (read.has(c.name) ? 'read' : 'write'),
    schema: ARGV_SCHEMA,
    describe: asSentence(c.summary || `Runs construct ${c.name}`),
  });
  return {
    list: () => offered().map(specOf),
    async call(name, args) {
      const command = offered().find((c) => commandToolName(c.name) === name);
      if (!command) throw new Error(`There is no tool named ${name}.`);
      const parsed = ARGV_SCHEMA.safeParse(args ?? {});
      if (!parsed.success) throw new Error(`${name} got arguments it cannot use: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'args'} ${i.message}`).join('; ')}.`);
      const argv = parsed.data.argv;
      const r = await captured(() => command.handler(argv));
      if (r.error && !r.error.processExit) {
        throw new Error(`construct ${command.name} stopped: ${firstLine(r.error.message).replace(/[.?!]$/, '')}`);
      }
      const exitCode = r.error?.processExit ? Number(r.error.exitCode) : r.exitCode;
      /** @type {import('../line-links/contracts').CommandStepResult} */
      const result = { command: command.name, argv, ok: exitCode === 0, exitCode, stdout: r.stdout, stderr: r.stderr };
      try { result.json = JSON.parse(r.stdout); } catch { /* not JSON output */ }
      return result;
    },
  };
}

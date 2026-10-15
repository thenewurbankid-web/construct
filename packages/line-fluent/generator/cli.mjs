// T5.1 generator CLI. `generate` writes a pending proposal and never touches the catalog; `approve` is the owner's
// step that writes one proposal into the catalog.
//
//   node packages/line-fluent/generator/cli.mjs generate <entry-key> [--fixtures f.json] [--real [--model m] [--url u]]
//        [--retries n] [--out dir]
//   node packages/line-fluent/generator/cli.mjs approve <proposal.json> [--catalog catalog.json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mockModel } from '../pilot/runner/mock-model.mjs';
import { callStudent, studentRequest } from '../student/student.mjs';
import { approveProposal, CATALOG_PATH, generate, PROPOSALS_DIR, writeProposal } from './generator.mjs';

export const USAGE = [
  'Usage:',
  '  generate <entry-key> [--fixtures f.json] [--real [--model m] [--url u]] [--retries n] [--out dir]',
  '  approve <proposal.json> [--catalog catalog.json]',
  '<entry-key> is a C1 key (overloads: "new Array #2") or id. generate uses the rules-only model unless --fixtures (mock model) or --real (local Ollama) is given.',
].join('\n');

const VALUED = new Set(['--fixtures', '--model', '--url', '--retries', '--out', '--catalog']);

export function parseArgs(args) {
  const opts = { positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUED.has(a)) opts[a.slice(2)] = args[++i];
    else if (a === '--real') opts.real = true;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}.`);
    else opts.positional.push(a);
  }
  return opts;
}

// Real model: the student (Ollama) with free continuation of the prefill, so the runner's prefill + text parse holds.
function realModel({ model, url, fetch }) {
  return async (request) => callStudent(studentRequest(request, { model, schema: null }), { url, fetch });
}

/** Returns the exit code; output goes through the injected streams so tests run in-process. */
export async function runCli(args, { stdout = process.stdout, stderr = process.stderr, fetch, catalogPath } = {}) {
  let opts;
  try {
    opts = parseArgs(args);
  } catch (e) {
    stderr.write(`${e.message}\n${USAGE}\n`);
    return 1;
  }
  const [command, target] = opts.positional;
  if (!target || !['generate', 'approve'].includes(command)) {
    stderr.write(`${USAGE}\n`);
    return 1;
  }
  try {
    if (command === 'approve') {
      const approved = approveProposal(target, { catalog: opts.catalog ?? catalogPath ?? CATALOG_PATH });
      stdout.write(`Approved ${approved.catalogEntry.atom} for ${approved.entry}; catalog: ${approved.catalog}\n`);
      return 0;
    }
    if (opts.real && opts.fixtures) throw new Error('Use either --real or --fixtures, not both.');
    let model;
    let modelName;
    if (opts.real) {
      modelName = `real:${opts.model ?? 'qwen2.5-coder:1.5b'}`;
      model = realModel({ model: opts.model, url: opts.url, fetch });
    } else if (opts.fixtures) {
      modelName = 'mock';
      model = mockModel(JSON.parse(readFileSync(opts.fixtures, 'utf8')));
    }
    const maxRetries = opts.retries === undefined ? 1 : Number(opts.retries);
    if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new Error('--retries must be a whole number.');
    const catalogOpt = catalogPath ? { catalog: JSON.parse(readFileSync(catalogPath, 'utf8')).atoms } : {};
    const { proposal } = await generate(target, { model, modelName, maxRetries, ...catalogOpt });
    const file = writeProposal(proposal, opts.out ?? PROPOSALS_DIR);
    const verdict = proposal.gate?.pass ? 'passed the gate' : `refused: ${proposal.gate?.refusal}`;
    stdout.write(`${proposal.entry}: ${proposal.answer?.decision ?? 'no answer'} (${verdict}, ${proposal.tries} tr${proposal.tries === 1 ? 'y' : 'ies'})\n`);
    stdout.write(`Pending proposal: ${file}\n`);
    stdout.write(proposal.adds ? `Approve with: approve ${file}\n` : 'Nothing to approve: this proposal adds no atom.\n');
    return 0;
  } catch (e) {
    stderr.write(`${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await runCli(process.argv.slice(2));
}

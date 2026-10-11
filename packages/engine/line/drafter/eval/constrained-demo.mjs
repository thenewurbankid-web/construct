// One-shot demo: an ALREADY-INSTALLED local model drafts one route under the generated GBNF grammar (llama.cpp
// constrained decoding on the model file Ollama already holds). Never pulls or downloads a model; exits quietly when
// llama.cpp or the model is absent. The output is checked against the JSON Schema form of the same grammar.
//   node packages/engine/line/drafter/eval/constrained-demo.mjs [ollama-model-tag]     (default qwen2.5-coder:1.5b)
// Result 2026-10-11 (docs/line/review.md): parses and validates, names only real tools and slots; the untrained model
// picks the wrong intent and repeats a step, which is what fine-tuning on recorded transitions is for.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv/dist/2020.js';
import { GRAMMAR_FILES } from '../grammar.mjs';

const tag = process.argv[2] ?? 'qwen2.5-coder:1.5b';
const [name, version] = tag.split(':');
const manifest = path.join(os.homedir(), '.ollama/models/manifests/registry.ollama.ai/library', name, version ?? 'latest');
let blob = null;
try {
  const layer = JSON.parse(fs.readFileSync(manifest, 'utf8')).layers.find((l) => /model$/.test(l.mediaType));
  blob = path.join(os.homedir(), '.ollama/models/blobs', layer.digest.replace(':', '-'));
} catch { /* not installed */ }
const bin = spawnSync('which', ['llama-completion'], { encoding: 'utf8' }).stdout.trim();
if (!blob || !fs.existsSync(blob) || !bin) {
  console.log(`Skipped: needs llama.cpp (llama-completion) and the installed model ${tag}; this demo never downloads anything.`);
  process.exit(0);
}
const prompt = [
  'You draft one Line plan route as JSON. Use only the slots given; never invent names.',
  'Request (normalized): add a <library:L1> to the <feature:F1> feature',
  'Slots: F1 = feature (layers ui, workflow); L1 = library component (atom); N1 = a new name (made up by Line).',
  'Answer with {"intent", "steps", "expect"}.',
  'JSON:',
].join('\n');
const t = Date.now();
const r = spawnSync(bin, ['-m', blob, '-p', prompt, '--grammar-file', fileURLToPathSafe(GRAMMAR_FILES.gbnf), '-n', '1200', '--temp', '0', '--no-display-prompt', '-no-cnv'], { encoding: 'utf8', maxBuffer: 1 << 24 });
const text = String(r.stdout).replace(/\[end of text\]\s*$/, '').trim();
let out = null;
try { out = JSON.parse(text); } catch { /* reported below */ }
const validate = new Ajv({ strict: false }).compile(JSON.parse(fs.readFileSync(GRAMMAR_FILES.schema, 'utf8')));
console.log(JSON.stringify({ model: tag, ms: Date.now() - t, parsed: out !== null, valid: out !== null && validate(out), output: out ?? text.slice(0, 400) }, null, 2));

/** A file URL as a path. @param {URL} u @returns {string} */
function fileURLToPathSafe(u) { return decodeURIComponent(u.pathname); }

// #647 -- NOTHING TRAINS ON THIS MACHINE. The Construct packages (core, cli, engine, mcp) import no training or model-runtime
// dependency, declare none, start no trainer, and carry no `train` verb: the only verbs are `traces export` (a dataset bundle for
// ANOTHER machine) and `model import|list|remove|enable|disable` (verify data that came back). The kit is a separate folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USAGE } from '../packages/core/usage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const PACKAGES = ['core', 'cli', 'engine', 'mcp'];

/** Package names of ML training and model runtimes (JavaScript ones and the Python ones a spawn could reach). */
const TRAINING_DEPENDENCY = /^(?:@tensorflow\/|tensorflow|@tensorflow-models\/|onnxruntime|@xenova\/|@huggingface\/|@mlx|mlx|transformers|brain\.js|ml-[a-z-]+|@?scikit|sklearn|xgboost|lightgbm|catboost|node-llama-cpp|llama-node|ggml|keras|jax|torch|pytorch|numpy|pandas|scipy|synaptic|convnetjs|@techstark\/opencv|opencv)(?:[/-]|$)/i;

function sources(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'test') walk(p); } else if (/\.(mjs|js|cjs|ts)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

test('packages/core, cli, engine and mcp import no training or model-runtime dependency', () => {
  let scanned = 0;
  for (const pkg of PACKAGES) {
    for (const file of sources(path.join(repo, 'packages', pkg))) {
      scanned += 1;
      const text = fs.readFileSync(file, 'utf8');
      const specifiers = [...text.matchAll(/(?:^|[\s;(])(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/gm)].map((m) => m[1]);
      for (const spec of specifiers) {
        const bare = spec.startsWith('.') || spec.startsWith('node:') ? null : spec;
        if (bare) assert.doesNotMatch(bare, TRAINING_DEPENDENCY, `${path.relative(repo, file)} imports ${spec}`);
      }
    }
  }
  assert.ok(scanned > 60, `scanned ${scanned} source files`);
});

test('no package declares a training dependency', () => {
  for (const pkg of PACKAGES) {
    const manifest = path.join(repo, 'packages', pkg, 'package.json');
    if (!fs.existsSync(manifest)) continue; // packages/engine is a folder of modules, not a package of its own
    const json = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const name of Object.keys(json[field] ?? {})) assert.doesNotMatch(name, TRAINING_DEPENDENCY, `packages/${pkg} declares ${name}`);
    }
  }
  const root = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  for (const name of Object.keys({ ...root.dependencies, ...root.devDependencies })) assert.doesNotMatch(name, TRAINING_DEPENDENCY, `the root package.json declares ${name}`);
});

test('no package starts a trainer: no python, and never the kit entry points train.sh or train_features', () => {
  for (const pkg of PACKAGES) {
    for (const file of sources(path.join(repo, 'packages', pkg))) {
      const text = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\([^)]*(?:train\.sh|train_features|train-kit)/, `${path.relative(repo, file)} starts the kit`);
      assert.doesNotMatch(text, /(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(\s*['"`](?:python3?|pip3?|conda|mlx[\w_.-]*|torchrun|accelerate)\b/, `${path.relative(repo, file)} starts a python or ML process`);
    }
  }
});

test('the only verbs are export and import: no `train` command, subcommand, usage line or exported function in the packages', () => {
  const dispatch = fs.readFileSync(path.join(repo, 'packages', 'cli', 'construct.mjs'), 'utf8');
  assert.doesNotMatch(dispatch, /cmd === '(?:train|fit|finetune|fine-tune)/);
  assert.doesNotMatch(USAGE, /construct (?:train|fit|finetune)\b/i);
  const cli = fs.readFileSync(path.join(repo, 'packages', 'core', 'cli.mjs'), 'utf8');
  assert.match(cli, /\['list', 'stats', 'replay', 'export'\]\.includes\(sub\)/, 'traces has exactly list, stats, replay and export');
  assert.match(cli, /\['list', 'import', 'remove', 'enable', 'disable'\]\.includes\(sub\)/, 'model has exactly list, import, remove, enable and disable');
  for (const pkg of PACKAGES) {
    for (const file of sources(path.join(repo, 'packages', pkg))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
        assert.doesNotMatch(m[1], /^(?:train|finetune|fineTune|fit(?:Model|Classifier)|backprop|gradientDescent)/, `${path.relative(repo, file)} exports ${m[1]}`);
      }
    }
  }
});

test('the kit is a folder of its own, outside every package', () => {
  assert.ok(fs.existsSync(path.join(repo, 'train-kit', 'train_features.py')));
  assert.equal(fs.existsSync(path.join(repo, 'packages', 'train-kit')), false);
  for (const pkg of fs.readdirSync(path.join(repo, 'packages'))) {
    const file = path.join(repo, 'packages', pkg, 'package.json');
    if (!fs.existsSync(file)) continue;
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(JSON.stringify(json.files ?? []).includes('train-kit'), false, `packages/${pkg} publishes the kit`);
    assert.equal(JSON.stringify(json.exports ?? {}).includes('train-kit'), false);
  }
});

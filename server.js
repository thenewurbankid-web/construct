const express = require('express');
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { chunkCode } = require('./chunker');
const { transform } = require('./transform');
const { scanModules, findSimilarShapes } = require('./module-scanner');
const trainingData = require('./training-data');
const { toEnglish, extractAtoms, extractAtomUsage, reorderSteps, atomParamNames, applyAtomToStep } = require('./to-english');
const registry = require('./registry');
const { plug } = require('./plug');

const CONFIG_PATH = path.join(__dirname, 'config.json');
// Two models, two jobs. 1.5b is fast but (measured) never performs extraction
// at all -- it just passes multi-concern code through unchanged. 7b does the
// extraction correctly but is heavy enough to freeze this machine, so it's
// only invoked when a cheap AST heuristic says extraction is plausible.
const DEFAULT_CONFIG = {
  ollamaUrl: 'http://localhost:11434',
  simpleModel: 'qwen2.5-coder:1.5b',
  extractionModel: 'qwen2.5-coder:7b',
  extractionThreshold: 2,
};

function readConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// Only the judgment-call part is left to the model: the deterministic rules
// (ternary -> if/else, comparison/logical operators -> named methods) are
// applied by the AST pass before this prompt ever runs, so a small model has
// one job instead of several.
const SYSTEM_PROMPT = `You are a precise JavaScript refactoring engine.
The code you receive has already been mechanically rewritten: no ternary expressions, and no raw ===, ==, !==, !=, >, <, >=, <=, &&, || operators (those are now if/else and named method calls like .equals()/.greaterThan()/.and()).
Your ONLY job: if this method/function does more than one distinct thing, extract each distinct concern into its own small, well-named method, and call it from the original one. If it already does only one thing, return it unchanged.
Rules:
- Do not reintroduce ternaries or any raw comparison/logical operator (===, ==, !==, !=, >, <, >=, <=, &&, ||).
- Do not change behavior.
- Do not add comments or explanation.
- Output ONLY the resulting code, no markdown fences.`;

function isValidJs(code) {
  try {
    parser.parse(code, { sourceType: 'module' });
    return true;
  } catch {
    return false;
  }
}

// Small local models don't reliably follow "don't do X" in a prompt (observed:
// qwen2.5-coder:1.5b reintroduced a ternary and a variable despite being told
// not to). Re-check the AST directly rather than trusting the instruction was obeyed.
const RAW_BINARY_OPERATORS = ['===', '==', '!==', '!=', '>', '<', '>=', '<='];
const RAW_LOGICAL_OPERATORS = ['&&', '||'];

function violatesRules(code) {
  let violated = false;
  const ast = parser.parse(code, { sourceType: 'module' });
  traverse(ast, {
    ConditionalExpression() {
      violated = true;
    },
    BinaryExpression(path) {
      if (RAW_BINARY_OPERATORS.includes(path.node.operator)) violated = true;
    },
    LogicalExpression(path) {
      if (RAW_LOGICAL_OPERATORS.includes(path.node.operator)) violated = true;
    },
  });
  return violated;
}

function stripFences(text) {
  return text
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

// A class-method chunk (e.g. "checkText(a, b) { ... }") isn't valid standalone
// JS on its own -- it needs a class body around it to parse or transform.
function wrap(code, kind) {
  return kind === 'method' ? `class __Wrapper__ {\n${code}\n}` : code;
}

function unwrap(code, kind) {
  if (kind !== 'method') return code;
  const chunks = chunkCode(code);
  return chunks.length ? chunks[0].code : code;
}

// Cheap, deterministic, no model call: count the TOP-LEVEL statements in the
// method/function body. A method with 1-2 top-level statements (even a big
// nested if/else from the ternary conversion -- that's still one statement)
// is already about one thing. Measured: with 3+ top-level statements
// (declare, loop, return -- validateAll's shape), extraction is worth trying;
// below that, the 7b call would just confirm "nothing to do" at GPU cost.
function likelyNeedsExtraction(code, kind, threshold) {
  const ast = parser.parse(wrap(code, kind), { sourceType: 'module' });
  let statementCount = 0;
  traverse(ast, {
    ClassMethod(path) {
      statementCount = path.node.body.body.length;
      path.stop();
    },
    FunctionDeclaration(path) {
      if (path.parentPath.isProgram()) {
        statementCount = path.node.body.body.length;
        path.stop();
      }
    },
  });
  return statementCount > threshold;
}

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/scan-atoms', (req, res) => {
  const dir = path.join(__dirname, req.query.dir || 'example-modules');
  try {
    res.json({ atoms: scanModules(dir) });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.get('/api/similar-shapes', async (req, res) => {
  const dir = path.join(__dirname, req.query.dir || 'example-modules');
  const cfg = readConfig();
  try {
    const atoms = scanModules(dir);
    // Naming a short identifier is a tiny generative task, not extraction --
    // the fast model is plenty and keeps this cheap.
    const groups = await findSimilarShapes(atoms, cfg.ollamaUrl, cfg.simpleModel);
    const newPairs = trainingData.recordFromGroups(groups);
    res.json({ groups, newPairsRecorded: newPairs });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.get('/api/training-data', (req, res) => {
  res.json(trainingData.stats());
});

app.get('/api/training-data/download', (req, res) => {
  if (!fs.existsSync(trainingData.PAIRS_PATH)) return res.status(404).json({ error: 'no training data yet' });
  res.download(trainingData.PAIRS_PATH, 'pairs.jsonl');
});

app.get('/api/config', (req, res) => res.json(readConfig()));

app.post('/api/config', (req, res) => {
  const cfg = { ...readConfig(), ...req.body };
  writeConfig(cfg);
  res.json(cfg);
});

app.get('/api/models', async (req, res) => {
  const cfg = readConfig();
  try {
    const r = await fetch(`${cfg.ollamaUrl}/api/tags`);
    const data = await r.json();
    res.json((data.models || []).map((m) => m.name));
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.post('/api/chunk', (req, res) => {
  try {
    res.json({ chunks: chunkCode(req.body.code || '') });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// Step 1 of the pipeline: pure AST pass, no LLM involved.
app.post('/api/ast-pass', (req, res) => {
  const kind = req.body.kind || 'function';
  try {
    const wrappedOutput = transform(wrap(req.body.code || '', kind));
    res.json({ output: unwrap(wrappedOutput, kind) });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// Atom usage (name, first-use order, call count) for one block, with each
// atom's implementation attached from the registry when one's registered
// under that name -- `null` (rendered as "no implementation yet" by the
// demo) when nothing's been registered for it. Synchronous: registry.load()
// just reads the JSON file, no Ollama call, so this is safe on every
// /api/to-english and /api/reorder-steps response.
function withImplementations(refactored, kind) {
  const entries = registry.load();
  return extractAtomUsage(refactored, kind).map((u) => {
    const entry = entries.find((e) => e.name === u.name);
    return { ...u, implementation: entry ? { code: entry.code, kind: entry.kind } : null };
  });
}

// Refactor to atoms FIRST (deterministic), then render THAT as English
// (also deterministic) -- readability is a property of the refactored
// shape, not a paraphrase of the original code, so no model is involved.
app.post('/api/to-english', (req, res) => {
  const kind = req.body.kind || 'function';
  try {
    const refactored = unwrap(transform(wrap(req.body.code || '', kind)), kind);
    const { english, steps, title } = toEnglish(refactored, kind);
    res.json({
      refactored,
      english,
      steps,
      title,
      atoms: extractAtoms(refactored, kind),
      atomUsage: withImplementations(refactored, kind),
    });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// Reorder (or drop) top-level steps of an already-refactored block. The
// client sends indices into the CURRENT steps array; the response's code
// and English are both derived fresh from the rebuilt AST, so they can
// never disagree with each other. No model involved.
app.post('/api/reorder-steps', (req, res) => {
  const kind = req.body.kind || 'function';
  const order = Array.isArray(req.body.order) ? req.body.order : [];
  try {
    const { code: refactored, breaks } = reorderSteps(req.body.code || '', kind, order);
    const { english, steps, title } = toEnglish(refactored, kind);
    steps.forEach((s, i) => { s.broken = breaks[i] || null; });
    res.json({ refactored, english, steps, title, atomUsage: withImplementations(refactored, kind) });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// A step's English was edited. Known wording (exact match on a registered
// atom's stored english, then embedding similarity) resolves to a call to
// that atom and the code updates; unknown wording comes back with the list
// of words that don't match anything registered, for the demo to underline
// and offer "add implementation" for.
app.post('/api/resolve-wording', async (req, res) => {
  const kind = req.body.kind || 'function';
  const stepIndex = req.body.stepIndex;
  const english = req.body.english || '';
  const cfg = readConfig();
  try {
    let match = registry.findByEnglish(english, 'function');
    let via = match ? 'exact' : null;
    if (!match) {
      try {
        const sim = await registry.findSimilarByEnglish(english, 'function', cfg.ollamaUrl);
        if (sim) {
          match = sim.match;
          via = 'embedding';
        }
      } catch (e) {
        // Embedding lookup is best-effort (needs Ollama reachable) -- fall
        // through to "unresolved" rather than failing the whole request.
      }
    }
    if (!match) {
      return res.json({ resolved: false, unrecognizedWords: registry.unrecognizedWords(english, 'function') });
    }
    const paramNames = atomParamNames(match.code);
    const refactored = applyAtomToStep(req.body.code || '', kind, stepIndex, match.name, paramNames);
    const { english: newEnglish, steps, title } = toEnglish(refactored, kind);
    res.json({ resolved: true, via, atom: match.name, refactored, english: newEnglish, steps, title, atomUsage: withImplementations(refactored, kind) });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

const VALID_NAME = /^[a-zA-Z_$][\w$]*$/;

// "Add implementation": saves a small standalone function as a new atom,
// keyed by the English wording that didn't resolve to anything. Once
// saved, the same wording resolves on the next /api/resolve-wording call.
app.post('/api/register-atom', async (req, res) => {
  const name = req.body.name || '';
  const params = Array.isArray(req.body.params) ? req.body.params : [];
  const body = req.body.body || '';
  const english = req.body.english || '';
  const cfg = readConfig();

  if (!VALID_NAME.test(name)) return res.status(400).json({ error: 'name must be a valid JS identifier' });
  if (!params.every((p) => VALID_NAME.test(p))) return res.status(400).json({ error: 'each param must be a valid JS identifier' });
  if (!english.trim()) return res.status(400).json({ error: 'english wording is required' });

  const code = `function ${name}(${params.join(', ')}) {\n${body}\n}`;
  if (!isValidJs(code)) return res.status(400).json({ error: 'body does not parse as valid JS' });

  try {
    const entry = await registry.register(name, 'function', code, cfg.ollamaUrl, english);
    res.json({ entry });
  } catch (e) {
    if (e instanceof registry.AtomRedefinitionError) return res.status(409).json({ error: e.message });
    res.status(400).json({ error: String(e) });
  }
});

// Step 2: send the AST-passed code to the local model for atomic extraction only.
app.post('/api/refactor', async (req, res) => {
  const cfg = readConfig();
  const model = req.body.model || cfg.extractionModel;
  const ollamaUrl = req.body.ollamaUrl || cfg.ollamaUrl;
  const kind = req.body.kind || 'function';
  const rawCode = req.body.code || '';

  let astOutput;
  try {
    astOutput = unwrap(transform(wrap(rawCode, kind)), kind);
  } catch (e) {
    return res.status(400).json({ error: `AST pass failed: ${e}` });
  }

  if (!likelyNeedsExtraction(rawCode, kind, cfg.extractionThreshold)) {
    return res.json({
      astOutput,
      llmOutput: null,
      valid: true,
      output: astOutput,
      skipped: true,
      note: `Already simple (≤${cfg.extractionThreshold} top-level statements) -- skipped the model entirely, no GPU call made.`,
    });
  }

  try {
    const r = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        // Bound compute regardless of model: our chunks are single methods,
        // never need anywhere near the model's full 4096-token context, and
        // capping output length prevents a runaway generation from pinning
        // the GPU longer than necessary.
        options: { num_ctx: 1024, num_predict: 400 },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: astOutput },
        ],
      }),
    });
    if (!r.ok) throw new Error(`Ollama responded ${r.status}`);
    const data = await r.json();
    const llmOutput = stripFences(data.message?.content || '');
    const wrappedLlmOutput = wrap(llmOutput, kind);
    const parses = isValidJs(wrappedLlmOutput);
    const clean = parses && !violatesRules(wrappedLlmOutput);
    res.json({
      astOutput,
      llmOutput,
      valid: clean,
      output: clean ? llmOutput : astOutput,
      note: clean
        ? null
        : parses
        ? 'Model output reintroduced a ternary or ===/== despite instructions; falling back to the AST-only pass.'
        : 'Model output did not parse as valid JS; falling back to the AST-only pass.',
    });
  } catch (e) {
    res.status(502).json({ error: String(e), astOutput });
  }
});

// PLUG (LIN-122 block 1): whole-file TSX text -> atomic-English module text.
// Deterministic AST pass only (transform.js), no LLM -- same "AST-ready
// first" rule as /api/ast-pass, just with the typescript+jsx parser plugins
// on so a real .tsx file parses.
app.post('/api/plug', (req, res) => {
  try {
    const plugged = plug(req.body.source || '');
    res.json({ plugged });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

const PORT = process.env.PORT || 5175;
app.listen(PORT, () => console.log(`Atomic codemod UI: http://localhost:${PORT}`));

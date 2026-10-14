// Can a small local model pick the atom where several fit? Tested in isolation, on places
// whose answer is already known (training-data/MODEL-GAPS.md, steps 1 and 2).
//
//   casesFromChecked(results, corpus) -> [{ id, fn, file, code, place, start, end, options, answer }]
//   evaluate({ model, arms, cases })  -> { arms: { name: { score, rows } } }
//
// Cases come from bench/results/atoms-checked.json (node bench/atoms/checked.js):
//   pick     a place the check settled by running each atom (`decisions[].chosen`).
//            The answer is the chosen atom; the model sees every atom that was tried.
//   neither  the same place with the chosen atom taken out of the options. The answer is
//            "neither": what the model should say when no option is right.
// The 27 places no input reaches are not cases: nothing says what their answer is.
//
// Arms (what the model is given, and how its answer is read):
//   free         the function and the file's type declarations; any text back, first word read
//   constrained  the same, the answer held to the options or "neither" (Ollama JSON schema)
//   checker      constrained, and the types the TypeScript checker gives the place's parts in
//                place of the file's declarations
//
// Every case is asked twice, the options once as listed and once reversed: the check
// settles ties in catalog order, so the right answer is nearly always listed first, and a
// small model that always takes the first option looks right. An answer counts only when
// both orders agree; when they differ it counts as "neither" (the place stays as it was).
//
// Scored per arm: right picks, right "neither", and wrong picks (a wrong atom is the costly
// mistake: unreached places cannot be checked; a needless "neither" only leaves code as it was).
//
// CLI: node bench/atoms/model-eval.js [--model qwen2.5-coder:1.5b] [--arms free,constrained,checker]
//   needs Ollama on localhost:11434; writes bench/results/model-eval-<model>.json
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const { createCheckerTypes } = require('./checker-types');

const PARSE_OPTS = { sourceType: 'module', plugins: ['typescript', 'jsx'] };
const NEITHER = 'neither';

function casesFromChecked(results, corpus) {
  const cases = [];
  for (const f of results.functions) {
    const src = corpus.functions.find((x) => x.name === f.name && path.basename(x.file) === f.file);
    if (!src) continue;
    f.decisions.forEach((d, i) => {
      if (!d.chosen) return;
      const base = { fn: f.name, file: src.file, code: src.code, kind: src.kind, place: d.source, start: d.start, end: d.end };
      const options = d.tried.map((t) => t.atom);
      cases.push({ id: `${f.name}:${d.start}:pick`, type: 'pick', ...base, options, answer: d.chosen });
      const rest = options.filter((a) => a !== d.chosen);
      if (rest.length) cases.push({ id: `${f.name}:${d.start}:neither`, type: 'neither', ...base, options: rest, answer: NEITHER });
    });
  }
  return cases;
}

// The file's type declarations, and what its typed consts are declared as
// (`const machine: AtomMachine<PollState<any>, ...> = ...`).
function declarationsOf(src) {
  const ast = parser.parse(src, PARSE_OPTS);
  const out = [];
  for (let n of ast.program.body) {
    if (n.type.startsWith('Export') && n.declaration) n = n.declaration;
    if (n.type === 'TSInterfaceDeclaration' || n.type === 'TSTypeAliasDeclaration') out.push(src.slice(n.start, n.end));
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.typeAnnotation) out.push(`const ${src.slice(d.id.start, d.id.end)} = ...`);
  }
  return out.join('\n');
}

function promptFor(c, { reads, context }) {
  return `${context}TypeScript function:
\`\`\`ts
${c.code}
\`\`\`
In this function, the expression \`${c.place}\` should be written with exactly one of these functions:
${c.options.map((o) => `- ${o}: ${reads[o] || ''}`).join('\n')}
If none of them fits the values there, answer "${NEITHER}".`;
}

async function ask({ model, prompt, options, constrained, url = 'http://localhost:11434/api/generate' }) {
  const body = {
    model,
    prompt: constrained ? `${prompt}\nAnswer as JSON: {"atom": "<name>"}.` : `${prompt}\nAnswer with only the function name.`,
    stream: false,
    think: false,
    options: { temperature: 0 },
  };
  if (constrained) body.format = { type: 'object', properties: { atom: { type: 'string', enum: [...options, NEITHER] } }, required: ['atom'] };
  const res = await fetch(url, { method: 'POST', body: JSON.stringify(body) }).then((x) => x.json());
  if (res.error) throw new Error(res.error);
  const text = (res.response || '').trim();
  if (constrained) {
    try { return JSON.parse(text).atom; } catch { return text; }
  }
  return text.split(/\s/)[0].replace(/[`*."']/g, '');
}

const ARMS = {
  free: { constrained: false, context: (c, h) => h.declarations(c) },
  constrained: { constrained: true, context: (c, h) => h.declarations(c) },
  checker: { constrained: true, context: (c, h) => h.checker(c) },
};

function score(rows) {
  const of = (type) => rows.filter((r) => r.type === type);
  const picks = of('pick');
  const neithers = of('neither');
  return {
    cases: rows.length,
    pickRight: picks.filter((r) => r.got === r.answer).length,
    pickSaidNeither: picks.filter((r) => r.got === NEITHER).length,
    neitherRight: neithers.filter((r) => r.got === NEITHER).length,
    wrongAtom: rows.filter((r) => r.got !== r.answer && r.got !== NEITHER).length,
    // without the agreement rule: the answer with the options as listed
    listedOrderRight: rows.filter((r) => r.asked[0] === r.answer).length,
    ordersDisagree: rows.filter((r) => r.asked[0] !== r.asked[1]).length,
    picks: picks.length,
    neithers: neithers.length,
  };
}

async function evaluate({ model, arms = Object.keys(ARMS), cases, reads, onRow = () => {} }) {
  const decls = new Map();
  const { typesAt } = createCheckerTypes();
  const helpers = {
    declarations: (c) => {
      if (!decls.has(c.file)) decls.set(c.file, declarationsOf(fs.readFileSync(c.file, 'utf8')));
      const d = decls.get(c.file);
      return d ? `Types declared in the same file:\n\`\`\`ts\n${d}\n\`\`\`\n` : '';
    },
    checker: (c) => {
      const lines = typesAt(c);
      return lines.length ? `Types the TypeScript checker gives the parts of the expression:\n${lines.map((l) => `- ${l}`).join('\n')}\n` : '';
    },
  };
  const out = {};
  for (const name of arms) {
    const arm = ARMS[name];
    const rows = [];
    for (const c of cases) {
      const t = Date.now();
      const context = arm.context(c, helpers);
      const asked = [];
      for (const options of [c.options, [...c.options].reverse()]) {
        asked.push(await ask({ model, prompt: promptFor({ ...c, options }, { reads, context }), options, constrained: arm.constrained }));
      }
      const got = asked[0] === asked[1] ? asked[0] : NEITHER;
      const row = { id: c.id, type: c.type, place: c.place, options: c.options, answer: c.answer, asked, got, ms: Date.now() - t };
      rows.push(row);
      onRow(name, row);
    }
    out[name] = { score: score(rows), rows };
  }
  return { model, arms: out };
}

if (require.main === module) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
  const model = arg('--model', 'qwen2.5-coder:1.5b');
  const arms = arg('--arms', Object.keys(ARMS).join(',')).split(',');
  const { loadCorpus } = require('../corpus');
  const { snapshotRuntime, catalogFor } = require('./runtime');
  const results = require('../results/atoms-checked.json');
  const snap = snapshotRuntime();
  const { catalog } = catalogFor(snap.dir, snap.sha);
  const reads = Object.fromEntries((catalog.atoms || catalog).map((e) => [e.atom, `${e.reads || ''} (${(e.js || [])[0] || ''})`]));
  const cases = casesFromChecked(results, loadCorpus());
  evaluate({ model, arms, cases, reads }).then((res) => {
    const file = path.join(__dirname, '..', 'results', `model-eval-${model.replace(/[^\w.-]+/g, '_')}.json`);
    fs.writeFileSync(file, `${JSON.stringify(res, null, 1)}\n`);
    for (const [name, { score: s }] of Object.entries(res.arms)) {
      console.log(`${name.padEnd(12)} picks ${s.pickRight}/${s.picks} right (${s.pickSaidNeither} said neither)   neither ${s.neitherRight}/${s.neithers} right   wrong atom ${s.wrongAtom}/${s.cases}   (orders disagree ${s.ordersDisagree}; listed order alone ${s.listedOrderRight}/${s.cases} right)`);
    }
  });
}

module.exports = { casesFromChecked, declarationsOf, promptFor, ask, score, evaluate, ARMS, NEITHER };

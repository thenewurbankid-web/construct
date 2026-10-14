// S9: the refactor is deterministic by default; the LLM step is opt-in.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { transform } = require('./transform');
const { plug } = require('./plug');
const { llmExtractionEnabled, DETERMINISTIC_RULES } = require('./refactor-policy');

test('LLM extraction is off by default and only an explicit true turns it on', () => {
  assert.equal(llmExtractionEnabled(), false);
  assert.equal(llmExtractionEnabled({}, {}), false);
  assert.equal(llmExtractionEnabled(JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')), {}), false);
  assert.equal(llmExtractionEnabled({ llmExtraction: 'yes' }, { llm: 1 }), false);
  assert.equal(llmExtractionEnabled({ llmExtraction: true }, {}), true);
  assert.equal(llmExtractionEnabled({}, { llm: true }), true);
});

test('server.js /api/refactor checks the gate before any model call', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const route = src.slice(src.indexOf("app.post('/api/refactor'"));
  const gate = route.indexOf('llmExtractionEnabled(cfg, req.body)');
  const call = route.indexOf('/api/chat');
  assert.ok(gate > 0 && call > gate, 'the LLM gate must come before the /api/chat fetch');
  assert.match(src, /llmExtraction: false/);
});

test('transform is deterministic and never touches the network', () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('transform must not call the network'); };
  try {
    const dir = path.join(__dirname, 'example-modules');
    const inputs = fs.readdirSync(dir).sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
    inputs.push(fs.readFileSync(path.join(__dirname, 'bench/fixtures/smith-sample.tsx'), 'utf8'));
    for (const src of inputs) {
      const a = plug(src);
      assert.equal(plug(src), a);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('documented deterministic rules match what transform does', () => {
  assert.ok(DETERMINISTIC_RULES.length >= 10);
  const out = (code) => transform(code);
  assert.match(out('function f(a, b) { return a === b; }'), /\.equals\(/);
  assert.match(out('function f(a) { return a !== 1; }'), /!a\.equals\(1\)/);
  assert.match(out('function f(a) { return a >= 1; }'), /greaterThanOrEqual/);
  assert.match(out('function f(a) { return g(a) && h(a); }'), /and\(g\(a\), h\(a\)\)/);
  assert.match(out('function f(a) { return a > 1 ? true : false; }'), /return a\.greaterThan\(1\);/);
  assert.match(out('function f(a, b) { return a; }'), /const \[a, b\] = /);
  assert.match(out('function f(o) { return o.name; }'), /o\.nameOfO\(\)/);
});

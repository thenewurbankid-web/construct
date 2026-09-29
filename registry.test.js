const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// register()/findSimilarByEnglish() call Ollama for embeddings -- not
// exercised here (no network calls in node --test, and the heavy model
// rule aside, nomic-embed-text still shouldn't run in an automated suite).
// This file only covers the deterministic, file-only parts: findByEnglish,
// unrecognizedWords, and normalize()'s per-kind wrapping.
const registry = require('./registry');

const REGISTRY_PATH = path.join(__dirname, 'atoms-registry.json');

function withRegistry(entries, fn) {
  const had = fs.existsSync(REGISTRY_PATH);
  const backup = had ? fs.readFileSync(REGISTRY_PATH, 'utf8') : null;
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(entries, null, 2));
  try {
    fn();
  } finally {
    if (had) fs.writeFileSync(REGISTRY_PATH, backup);
    else fs.unlinkSync(REGISTRY_PATH);
  }
}

test('findByEnglish matches exactly, case/whitespace-insensitively', () => {
  withRegistry(
    [{ name: 'clamp', kind: 'function', code: 'function clamp(){}', fingerprint: 'x', embedding: [], english: 'clamp value between min and max' }],
    () => {
      const hit = registry.findByEnglish('  Clamp Value Between Min And Max  ', 'function');
      assert.equal(hit.name, 'clamp');
      assert.equal(registry.findByEnglish('something else entirely', 'function'), null);
      assert.equal(registry.findByEnglish('clamp value between min and max', 'method'), null); // wrong kind
    }
  );
});

test('unrecognizedWords ignores connector words and words already registered', () => {
  withRegistry(
    [{ name: 'clamp', kind: 'function', code: 'function clamp(){}', fingerprint: 'x', embedding: [], english: 'clamp value between min and max' }],
    () => {
      assert.deepEqual(registry.unrecognizedWords('clamp value between min and max', 'function'), []);
      assert.deepEqual(registry.unrecognizedWords('frobnicate the widget', 'function'), ['frobnicate', 'widget']);
    }
  );
});

test('unrecognizedWords on an empty registry flags every non-connector word', () => {
  withRegistry([], () => {
    assert.deepEqual(registry.unrecognizedWords('let total be a plus b', 'function'), ['total', 'plus', 'b']);
  });
});

test('normalize wraps method code in a class but leaves function/other code raw', () => {
  assert.doesNotThrow(() => registry.normalize('run(a) { return a; }', 'method'));
  assert.doesNotThrow(() => registry.normalize('let x = a;', 'function'));
});

test('findByName matches an atom by its camelCase name spoken as words, or the name itself', () => {
  withRegistry(
    [{ name: 'greaterThanOrEqual', kind: 'function', code: 'function greaterThanOrEqual(a,b){}', fingerprint: 'x', embedding: [] }],
    () => {
      const hit = registry.findByName('Greater Than Or Equal', 'function');
      assert.equal(hit.name, 'greaterThanOrEqual');
      const hitByRawName = registry.findByName('greaterThanOrEqual', 'function');
      assert.equal(hitByRawName.name, 'greaterThanOrEqual');
      assert.equal(registry.findByName('something else', 'function'), null);
      assert.equal(registry.findByName('greater than or equal', 'method'), null); // wrong kind
    }
  );
});

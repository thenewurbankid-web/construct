// packages/core/yaml-edit.mjs: in-place YAML edits keep every comment, blank line and key order, and change only
// the edited values (the Rules editor used to rewrite architecture.yml with yaml.dump, deleting all of them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editYamlDocument, editFrontMatter, joinFrontMatter, parseYamlDocument, splitFrontMatter, YamlEditError } from '@line/construct-core/yaml-edit';

const ARCH = `# Team rules: talk to #platform before loosening any of these.
version: 1
preset: line

# Severity overrides, newest last
rules:
  PAGE-001: error # pages stay thin
  DOMAIN-002: warning

frozen:
  - src/generated/** # codegen output

# Imported code we are still migrating
exceptions:
  - path: legacy/**
    rules: [PAGE-001, PAGE-002]
    expires: 2027-01-01 # remove after the migration
    reason: "old code"

features:
  root: src/features
`;

/** The lines of `after` that differ from `before`, as [line number, before, after]. */
function changedLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) if (a[i] !== b[i]) out.push([i + 1, a[i], b[i]]);
  return out;
}

test('setting one rule keeps every comment, blank line and key order; only that value changes', () => {
  const after = editYamlDocument(ARCH, [{ op: 'set', path: ['rules', 'PAGE-001'], value: 'off' }]);
  assert.deepEqual(changedLines(ARCH, after), [[7, '  PAGE-001: error # pages stay thin', '  PAGE-001: off # pages stay thin']]);
});

test('adding a new key under an existing map appends it there, leaving the rest as written', () => {
  const after = editYamlDocument(ARCH, [{ op: 'set', path: ['rules', 'HOOK-001'], value: 'warning' }]);
  assert.equal(after, ARCH.replace('  DOMAIN-002: warning\n', '  DOMAIN-002: warning\n  HOOK-001: warning\n'));
});

test('push lands inside exceptions even when it is not the last key; delete removes one item', () => {
  const pushed = editYamlDocument(ARCH, [{ op: 'push', path: ['exceptions'], value: { path: 'app/x.tsx', rules: ['PAGE-001'], reason: 'Imported; later.' }, inlineLists: true }]);
  assert.equal(pushed, ARCH.replace('    reason: "old code"\n', '    reason: "old code"\n  - path: app/x.tsx\n    rules: [PAGE-001]\n    reason: Imported; later.\n'));
  const removed = editYamlDocument(pushed, [{ op: 'delete', path: ['exceptions', 0] }]);
  assert.ok(!removed.includes('legacy/**'));
  assert.ok(removed.includes('# Imported code we are still migrating'));
  assert.ok(removed.endsWith('features:\n  root: src/features\n'));
});

test('a file that writes lists flush with their key keeps that style', () => {
  const flush = 'nonLayer:\n- scripts/**\n# keep\nfrozen:\n- a/**\n';
  assert.equal(editYamlDocument(flush, [{ op: 'push', path: ['nonLayer'], value: 'tools/**' }]), 'nonLayer:\n- scripts/**\n- tools/**\n# keep\nfrozen:\n- a/**\n');
});

test('an empty file, a comment-only file and an empty key all take a new value', () => {
  assert.equal(editYamlDocument('', [{ op: 'set', path: ['rules', 'X'], value: 'off' }]), 'rules:\n  X: off\n');
  assert.equal(editYamlDocument('# only notes\n', [{ op: 'set', path: ['rules', 'X'], value: 'off' }]), '# only notes\n\nrules:\n  X: off\n');
  assert.equal(editYamlDocument('version: 1\nrules:\n', [{ op: 'set', path: ['rules', 'X'], value: 'off' }]), 'version: 1\nrules:\n  X: off\n');
});

test('setting a map reuses the nodes already there, so an unchanged map is byte for byte the same', () => {
  const after = editYamlDocument(ARCH, [{ op: 'set', path: ['features'], value: { root: 'src/features' } }]);
  assert.equal(after, ARCH);
});

test('a syntax error is refused with its line and column', () => {
  assert.throws(() => parseYamlDocument('a: 1\nb: [1, 2\nc: 3\n', 'architecture.yml'), (e) => {
    assert.ok(e instanceof YamlEditError);
    assert.equal(e.code, 'PARSE');
    assert.equal(typeof e.line, 'number');
    assert.equal(typeof e.col, 'number');
    assert.match(e.message, /^architecture\.yml is not valid YAML at line \d+, column \d+: /);
    return true;
  });
  assert.throws(() => editYamlDocument('a: [\n', [{ op: 'set', path: ['a'], value: 1 }]), YamlEditError);
  assert.throws(() => editYamlDocument('a: 1\n', [{ op: 'rename', path: ['a'] }]), YamlEditError);
});

const STORY = `---
# Picked by hand in the Picker
title: Refund a delivered order
sources:
  - url: https://acme.atlassian.net/browse/STORE-142 # main ticket
    parse:
      title: h1.title
owner: payments
---
# Notes
Written by hand.
`;

test('splitFrontMatter and joinFrontMatter are inverses; a file without front matter is all body', () => {
  const { frontMatter, block, body } = splitFrontMatter(STORY);
  assert.equal(block + body, STORY);
  assert.equal(joinFrontMatter(frontMatter, body), STORY);
  assert.deepEqual(splitFrontMatter('# Just text\n'), { frontMatter: null, block: '', body: '# Just text\n' });
  assert.equal(splitFrontMatter('---\r\na: 1\r\n---\r\nB').frontMatter, 'a: 1');
});

test('editing front matter keeps its comments and key order and the body byte for byte', () => {
  const after = editFrontMatter(STORY, [{ op: 'set', path: ['sources', 0, 'parse', 'title'], value: 'h1#summary' }]);
  assert.deepEqual(changedLines(STORY, after), [[7, '      title: h1.title', '      title: h1#summary']]);
  assert.equal(editFrontMatter('Body\n', [{ op: 'set', path: ['title'], value: 'T' }]), '---\ntitle: T\n---\nBody\n');
});

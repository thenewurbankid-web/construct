import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticsForNode, severityLabel } from './NodeDiagnostics.ts';

const diag = (line, message = 'x') => ({ source: 'architecture', code: 'SLICE-001', severity: 'error', message, line, column: 1, endLine: line, endColumn: 2, mechanicalFixAvailable: false });
const node = (line, children = []) => ({ id: `n${line}`, tag: 'div', isFragment: false, isCustomComponent: false, props: [], line, children });

test('diagnosticsForNode keeps only lines within the node and its deepest descendant', () => {
  const tree = node(3, [node(5), node(9)]);
  const diagnostics = [diag(2), diag(3), diag(7), diag(9), diag(10)];
  assert.deepEqual(diagnosticsForNode(tree, diagnostics).map((d) => d.line), [3, 7, 9]);
});

test('diagnosticsForNode is [] for a node with no recorded line', () => {
  const tree = { id: 'root', tag: 'Fragment', isFragment: true, isCustomComponent: false, props: [], children: [] };
  assert.deepEqual(diagnosticsForNode(tree, [diag(1)]), []);
});

test('a leaf node (no children) only matches its own exact line', () => {
  const leaf = node(4);
  assert.deepEqual(diagnosticsForNode(leaf, [diag(3), diag(4), diag(5)]).map((d) => d.line), [4]);
});

test('severityLabel is always a word, never only a colour', () => {
  assert.equal(severityLabel('error'), 'Error');
  assert.equal(severityLabel('warning'), 'Warning');
  assert.equal(severityLabel('info'), 'Note');
});

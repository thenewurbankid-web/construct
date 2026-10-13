import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBriefs, goalSignatures, fixtureType } from '../briefBuilder.mjs';
import { applyPrelude } from '../spliceApplier.mjs';

const TASKS = join(dirname(fileURLToPath(import.meta.url)), '../../tasks');
const load = (id) => {
  const task = JSON.parse(readFileSync(join(TASKS, id, 'task.json'), 'utf8'));
  const read = (p) => {
    for (const d of [join(id, 'start'), '_r2', '_shared']) if (existsSync(join(TASKS, d, p))) return readFileSync(join(TASKS, d, p), 'utf8');
    throw new Error(`missing ${p}`);
  };
  return { task, read, file: read(task.target) };
};

test('every task gets a brief of at most ~1.5k tokens', () => {
  for (const id of readdirSync(TASKS).filter((d) => /^t\d\d-/.test(d))) {
    const { briefs } = buildBriefs(load(id));
    assert.ok(briefs.length >= 1, id);
    for (const b of briefs) assert.ok(b.approxTokens <= 1500, `${id} ${b.name}: ${b.approxTokens}`);
  }
});

test('book brief carries the exact signature, the local Book type, DetailPage props and the SPEC line', () => {
  const { briefs } = buildBriefs(load('t01-book-by-author'));
  const b = briefs[0].brief;
  assert.equal(briefs[0].name, 'BookPage');
  assert.match(b, /SIGNATURE: export function BookPage\(\{ params \}: \{ params: \{ id: string \} \}\)/);
  assert.match(b, /type Book = \{ id: string; title: string; author: string/);
  assert.match(b, /export type DetailPageProps = \{/);
  assert.match(b, /"by <author>"/);
  assert.match(b, /CURRENT BookPage:/);
});

test('button kind adds use client, useState and the context imports to the prelude', () => {
  const t = load('t05-book-add-to-picks');
  const { prelude } = buildBriefs(t);
  assert.ok(prelude.includes("'use client';"));
  assert.ok(prelude.includes("import { useState } from 'react';"));
  assert.ok(prelude.some((l) => /import \{ listPicks, addPick, removePick \} from '\.\.\/\.\.\/picks\/store\/picksStore';/.test(l)));
  const out = applyPrelude(t.file, prelude, t.task.target);
  assert.ok(out.startsWith("'use client';\n"));
  assert.match(out, /import \{ Button \} from '\.\.\/\.\.\/\.\.\/library\/components\/Button';/);
});

test('#943: a page brief points at the feature service, never the fixture', () => {
  const { prelude, briefs } = buildBriefs(load('t07-picks-page-list'));
  assert.ok(prelude.includes("import { pickedBooks, type Book } from '../services/pickedBooks';"));
  assert.ok(!prelude.some((l) => /fixtures\/books\.json|^type Book =/.test(l)));
  assert.ok(!/fixtures\/books\.json|products as/.test(briefs[0].brief));
  assert.match(briefs[0].brief, /never import a fixture file/);
  for (const id of ['t01-book-by-author', 't09-browse-heading-availability', 't12-browse-genre-filter']) {
    const b = buildBriefs(load(id));
    assert.ok(!b.prelude.some((l) => /fixtures\//.test(l)), id);
  }
});

test('a stub store gets one brief per function the goal spells out', () => {
  const { briefs } = buildBriefs(load('t06-picks-store'));
  assert.deepEqual(briefs.map((b) => b.name), ['listPicks', 'addPick', 'removePick']);
  assert.match(briefs[1].brief, /SIGNATURE: export function addPick\(id: string\): void/);
});

test('goalSignatures and fixtureType', () => {
  assert.deepEqual(goalSignatures('use f(a: string): void, and g(): string[] (x)').map((g) => g.name), ['f', 'g']);
  assert.equal(fixtureType('Row', [{ id: 'a', n: 1, ok: true }]), 'type Row = { id: string; n: number; ok: boolean };');
});

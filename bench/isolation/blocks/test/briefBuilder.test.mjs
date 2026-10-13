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

test('list kind brings in the fixture import and its element type', () => {
  const { prelude } = buildBriefs(load('t07-picks-page-list'));
  assert.ok(prelude.includes("import books from '../../../library/fixtures/books.json';"));
  assert.ok(prelude.some((l) => l.startsWith('type Book = { id: string; title: string;')));
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

test('every template example is one function, so the prompt matches the one-function splice', async () => {
  const { templates } = await import('../templates.mjs');
  const { ts, parse } = await import('../../lib/edit.mjs');
  for (const [kind, tpl] of Object.entries(templates)) {
    const sts = parse(tpl.example, 'x.tsx').statements;
    assert.equal(sts.length, 1, `${kind} example has ${sts.length} top-level statements`);
    assert.ok(ts.isFunctionDeclaration(sts[0]) && sts[0].body, `${kind} example is not one function`);
  }
});

test('a multi-function brief names only its own function in TASK (fnGoal)', () => {
  const { task, read, file } = load('t06-picks-store');
  const { briefs } = buildBriefs({ task, file, read });
  const names = briefs.map((b) => b.name);
  assert.deepEqual(names, ['listPicks', 'addPick', 'removePick']);
  for (const b of briefs) {
    assert.match(b.brief.match(/^TASK: .*$/m)[0], new RegExp(`\\b${b.name}\\(`));
    assert.deepEqual(names.filter((n) => n !== b.name && b.brief.includes(n)), [], `${b.name}'s brief names another target`);
  }
  // A page task keeps its goal as it is, even when the goal mentions a store function.
  for (const id of ['t03-book-availability', 't05-book-add-to-picks']) {
    const t = load(id);
    assert.ok(buildBriefs({ task: t.task, file: t.file, read: t.read }).briefs[0].brief.includes(`TASK: ${t.task.goal}`), id);
  }
});

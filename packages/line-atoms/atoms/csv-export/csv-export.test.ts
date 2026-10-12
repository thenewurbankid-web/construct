import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, createCsvMachine, toCsv, csvCell, csvFileName, exportCsv } from './index.ts';
import type { Column } from './index.ts';
import { kitFor } from '../../testkit.mjs';

const kit = kitFor(machine);
type Order = { id: number; customer: string; total: number; note?: string };
const columns: Column<Order>[] = [
  { header: 'Order', accessor: 'id' },
  { header: 'Customer', accessor: 'customer' },
  { header: 'Total', accessor: (o) => `$${o.total.toFixed(2)}` },
];

test('EXPORT: rows make a ready file, no rows make it empty again', () => {
  let s = kit.init();
  assert.equal(kit.send(s, { type: 'EXPORT', rows: [] }), s, 'nothing to export');
  s = kit.send(s, { type: 'EXPORT', rows: [{ a: 1, b: 'x' }] });
  assert.equal(s.status, 'ready');
  assert.equal(s.csv, 'a,b\r\n1,x\r\n');
  s = kit.send(s, { type: 'EXPORT', rows: [{ a: 2 }] });
  assert.equal(s.status, 'ready');
  s = kit.send(s, { type: 'EXPORT', rows: [] });
  assert.equal(s.status, 'empty');
  assert.equal(kit.send(s, { type: 'OTHER' } as any), s);
});

test('typed columns, accessor functions and RFC 4180 quoting', () => {
  const m = createCsvMachine(columns);
  const s = m.send(m.init(), { type: 'EXPORT', rows: [{ id: 1, customer: 'Ada, Countess', total: 48 }, { id: 2, customer: 'Bob "B"', total: 5.5 }] });
  assert.equal(s.csv, 'Order,Customer,Total\r\n1,"Ada, Countess",$48.00\r\n2,"Bob ""B""",$5.50\r\n');
  assert.equal(s.rows, 2);
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(new Date('2026-10-12T00:00:00Z')), '2026-10-12T00:00:00.000Z');
  assert.equal(toCsv([{ a: 'x;y' }], [{ header: 'a', accessor: 'a' }], { separator: ';', eol: '\n' }), 'a\n"x;y"\n');
});

test('formula cells are made safe unless turned off', () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('-5'), "'-5");
  assert.equal(csvCell('=1', { safe: false }), '=1');
  assert.equal(csvCell(-5), "'-5", 'a negative number reads as a formula start too');
});

test('file names and the one-call export', () => {
  assert.equal(csvFileName('  Orders / October ', new Date('2026-10-12T10:00:00Z')), 'orders-october-2026-10-12.csv');
  assert.equal(csvFileName('***', new Date('2026-10-12T10:00:00Z')), 'export-2026-10-12.csv');
  const out = exportCsv([{ id: 1, customer: 'Ada', total: 1 }], columns, 'orders', new Date('2026-10-12T00:00:00Z'));
  assert.equal(out.fileName, 'orders-2026-10-12.csv');
  assert.equal(out.mime, 'text/csv;charset=utf-8');
});

test('the test kit covered every state, event and transition', () => kit.assertComplete());

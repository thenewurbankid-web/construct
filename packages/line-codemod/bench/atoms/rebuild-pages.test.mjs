// rebuild-pages.mjs --check logic on a small synthetic fixture: no Smith build, no builders run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPages, embeddedData } from './rebuild-pages.mjs';

const page = (data) => `<html><body><script type="application/json" id="data">${JSON.stringify(data)}</script></body></html>`;

function fixture({ atoms = 3, items = 2, catalog = 3, reference = 2, skip = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rebuild-pages-'));
  const paths = {
    catalog: join(dir, 'catalog.json'), reference: join(dir, 'reference.json'),
    atomsPage: join(dir, 'atoms.html'), referencePage: join(dir, 'reference.html'),
  };
  writeFileSync(paths.catalog, JSON.stringify({ atoms: Array.from({ length: catalog }, (_, i) => ({ atom: `a${i}` })) }));
  writeFileSync(paths.reference, JSON.stringify({ entries: Array.from({ length: reference }, (_, i) => ({ key: `k${i}` })) }));
  if (!skip.includes('atomsPage')) writeFileSync(paths.atomsPage, page({ stats: {}, atoms: Array.from({ length: atoms }, () => ({})) }));
  if (!skip.includes('referencePage')) writeFileSync(paths.referencePage, page({ stats: {}, items: Array.from({ length: items }, () => ({})) }));
  return { dir, paths };
}

test('matching counts pass and report both', () => {
  const { dir, paths } = fixture();
  const r = checkPages(paths);
  rmSync(dir, { recursive: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { catalog: 3, atomsPage: 3, reference: 2, referencePage: 2 });
});

test('an atom count mismatch fails with one sentence naming both numbers', () => {
  const { dir, paths } = fixture({ atoms: 2 });
  const r = checkPages(paths);
  rmSync(dir, { recursive: true });
  assert.equal(r.ok, false);
  assert.match(r.message, /has 2 atoms but the catalog has 3/);
  assert.equal(r.message.split('. ').length, 1);
});

test('a reference count mismatch fails', () => {
  const { dir, paths } = fixture({ items: 5 });
  const r = checkPages(paths);
  rmSync(dir, { recursive: true });
  assert.equal(r.ok, false);
  assert.match(r.message, /has 5 entries but reference\.json has 2/);
});

test('a missing page fails and says which', () => {
  const { dir, paths } = fixture({ skip: ['referencePage'] });
  const r = checkPages(paths);
  rmSync(dir, { recursive: true });
  assert.equal(r.ok, false);
  assert.match(r.message, /reference\.html does not exist/);
  assert.equal(r.counts.referencePage, null);
});

test('embeddedData reads the data script and rejects a page without one', () => {
  assert.deepEqual(embeddedData(page({ a: 1 })), { a: 1 });
  assert.throws(() => embeddedData('<html></html>'), /no embedded data/);
});

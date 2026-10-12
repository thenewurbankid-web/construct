#!/usr/bin/env node
// Makes the bench starters. Run once; the results are committed (with their package-lock, installed via heavy.sh).
//
//   node bench/ecommerce/make-starter.mjs line  [dir]   bench/ecommerce/starter: Construct's new-Line-project flow
//        (createLineProject, the same call as Cockpit's New Line project), then ONE change through Construct's checked
//        writer (applyChange, gated by `validate --profile line`) that adds the Next.js + Tailwind shell and replaces the
//        generic starter library with the Radix-based base components, pages, workflows and the product fixtures.
//   node bench/ecommerce/make-starter.mjs plain [dir]   bench/ecommerce/starter-plain: the same app and base components,
//        no Line (no architecture.yml, library/ or features/), written as plain files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLineProject } from '../../packages/engine/line/newProject.mjs';
import { applyChange } from '../../packages/engine/line/ops.mjs';
import { appLayoutSource, renderAppLayout } from '../../packages/engine/line/shell.mjs';
import { shellFiles, baseComponents, basePages, baseWorkflows, productsJson } from './starter-files.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arm = process.argv[2];
if (arm !== 'line' && arm !== 'plain') { console.error('usage: make-starter.mjs line|plain [dir]'); process.exit(2); }
const dir = path.resolve(process.argv[3] ?? path.join(here, arm === 'line' ? 'starter' : 'starter-plain'));
if (fs.existsSync(dir)) { console.error(`${dir} already exists; remove it first.`); process.exit(1); }

if (arm === 'line') {
  const made = createLineProject(path.dirname(dir), { name: path.basename(dir), firstFeature: 'catalog' });
  if (!made.ok) { console.error(made.sentence); process.exit(1); }
  /** @type {Record<string, string|null>} */
  const files = { ...shellFiles('bench-ecommerce-line', '../library/components/Toast') };
  for (const [n, src] of Object.entries(baseComponents(true))) files[`library/components/${n}.tsx`] = src;
  for (const [n, src] of Object.entries(basePages('../components'))) files[`library/pages/${n}.tsx`] = src;
  for (const [n, src] of Object.entries(baseWorkflows())) files[`library/workflows/${n}.ts`] = src;
  // bench-gaps 2: the app shell is Line's (shell.mjs): app/layout.tsx renders the library AppLayout, whose slots
  // line.setLayoutSlot fills (a cart link on every page is one step).
  files['library/components/AppLayout.tsx'] = appLayoutSource({ provider: { name: 'ToastProvider', from: './Toast' } });
  files['app/layout.tsx'] = renderAppLayout(dir, { slots: {}, title: 'Shop', css: true });
  files['library/fixtures/products.json'] = productsJson();
  files['library/fixtures/item.json'] = null;
  files['README.md'] = '# bench-ecommerce (Line arm)\n\nA Line project (Next.js app router, Tailwind, Radix UI base components) for the e-commerce bench. `library/` holds the base components, pages, workflows and the product fixtures; `features/<name>/` holds one feature each, with its spec.md; `app/` holds only the root layout and route entries (`export { Page as default } from \'<feature page>\'`); `line/` is Line\'s own state.\n\nCheck it: `construct validate --dir . --profile line`. Change it only through `bench/ecommerce/driver/plan-cli.mjs`.\n';
  const r = applyChange(dir, { summary: 'Adds the Next.js app-router and Tailwind shell and the Radix-based base library of the e-commerce bench.', files: Object.entries(files).map(([p, content]) => ({ path: p, content })) });
  console.log(JSON.stringify({ ok: r.ok, sentence: r.sentence, findings: r.findings.slice(0, 5) }, null, 2));
  process.exit(r.ok ? 0 : 1);
}

const files = { ...shellFiles('bench-ecommerce-plain', '../components/ui/Toast') };
for (const [n, src] of Object.entries(baseComponents(false))) files[`components/ui/${n}.tsx`] = src;
for (const [n, src] of Object.entries(basePages('../ui'))) files[`components/layouts/${n}.tsx`] = src;
for (const [n, src] of Object.entries(baseWorkflows())) files[`lib/workflows/${n}.ts`] = src;
files['lib/products.json'] = productsJson();
files['README.md'] = '# bench-ecommerce (plain arm)\n\nA Next.js app router + Tailwind app with Radix UI base components in `components/ui/`, layout pages in `components/layouts/`, workflows and the product fixtures in `lib/`. No Line. Change it only through `bench/ecommerce/driver/plain-cli.mjs`.\n';
for (const [p, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), content); }
console.log(JSON.stringify({ ok: true, sentence: `Wrote ${Object.keys(files).length} files to ${dir}.` }));

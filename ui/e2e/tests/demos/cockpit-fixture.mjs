// Shared fixture for the Cockpit demo guide (docs/demos/cockpit/).
// A small but realistic "people" feature: a profile page, two components,
// plus checkout and refund workflows. Everything is written to a throwaway
// temp directory and loaded through the real settings API, exactly as a user
// would switch project.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileWorkflow } from '../../../../src/engine/workflowGenerator.mjs';
import { annotateJsxSource } from '../../../../src/engine/jsxSourceAnnotator.mjs';
import { previewBridgeScript } from '../../../../src/engine/previewBridge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';
export const SHOTS = path.resolve(__dirname, '../../screenshots/demos');
fs.mkdirSync(SHOTS, { recursive: true });
export const shot = (name) => path.join(SHOTS, name);

export const PROFILE_PAGE = `import React, { useState } from 'react';
import { Card } from '../components/Card';
import { Foo } from '../components/Foo';

export default function ProfilePage({ title, count }: { title: string; count: number }) {
  const [open, setOpen] = useState(false);

  return (
    <main>
      <h1>{title}</h1>
      <p>Welcome back</p>
      <Card title={title} total={count + 1} label="hi" />
      <Foo.Bar size={count} />
    </main>
  );
}
`;

export const CARD = `export function Card({ title, total, onClose, open }: { title: string; total: number; onClose?: () => void; open?: boolean }) {
  return <div>{title}{total}</div>;
}
`;

export const FOO = `export function Foo() { return null; }
export function Bar({ size, tone }: { size: number; tone?: string }) {
  return <span>{size}{tone}</span>;
}
`;

const FIX = path.resolve(__dirname, '../../../../fixtures/workflow-graphs');
const CHECKOUT = JSON.parse(fs.readFileSync(path.join(FIX, 'checkout.json'), 'utf8'));
export const CHECKOUT_SRC = compileWorkflow(CHECKOUT, { name: 'Checkout' }).source;
export const REFUND_SRC = fs.readFileSync(path.join(FIX, 'refund-request.ts'), 'utf8');

/** Creates the fixture project and points the server at it. */
export async function makeProject(request, prefix = 'construct-demo-cockpit-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const original = (await (await request.get(`${API_BASE}/api/settings`)).json()).projectDir;
  await request.post(`${API_BASE}/api/settings`, { data: { projectDir: dir } });
  await request.post(`${API_BASE}/api/init`);
  await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Profile', feature: 'people', layer: 'page' } });
  await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Seed', feature: 'shop', layer: 'workflow' } });
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  w('features/people/pages/ProfilePage.tsx', PROFILE_PAGE);
  w('features/people/components/Card.tsx', CARD);
  w('features/people/components/Foo.tsx', FOO);
  w('features/shop/workflows/CheckoutWorkflow.tsx', CHECKOUT_SRC);
  w('features/shop/workflows/RefundRequestWorkflow.ts', REFUND_SRC);
  return { dir, original };
}

export async function cleanup(request, { dir, original }) {
  await request.post(`${API_BASE}/api/settings`, { data: { projectDir: original || path.resolve(__dirname, '../../../..') } });
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Stand-in for the user's running app: real annotator output + real preview bridge. */
export async function startPreviewServer(port) {
  const { code } = annotateJsxSource(PROFILE_PAGE, { file: 'features/people/pages/ProfilePage.tsx' });
  const src = (tag) => new RegExp(`<${tag} data-cx-src="([^"]+)"`).exec(code)[1];
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:24px;background:#fff;color:#1a1a1a">
<main data-cx-src="${src('main')}"><h1 data-cx-src="${src('h1')}">Priya Nair</h1>
<p data-cx-src="${src('p')}">Welcome back</p>
<footer data-cx-src="features/people/components/Footer.tsx:2:3" style="margin-top:24px;color:#666">Footer (from another file)</footer></main>
<script>${previewBridgeScript()}</script></body></html>`;
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return server;
}

/** Hides Next.js's dev-only "N" badge so it never sits on top of a demo screenshot. */
export async function noDevBadge(page) {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = 'nextjs-portal { display: none !important; }';
      document.head.append(s);
    });
  });
}

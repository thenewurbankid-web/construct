import { expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// What an owner's walk must never meet: a console error or a failed request (4xx/5xx). Collected per page and
// checked at the end of each walk, with the URL or message, so a failure says what went wrong.
export function watchForProblems(page) {
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return { check: () => expect(problems, problems.join('\n')).toEqual([]) };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SAMPLE = path.resolve(__dirname, '../../../../examples/line-sample');
export const API = process.env.E2E_API_BASE || `http://localhost:${process.env.E2E_SERVER_PORT || 4000}`;

/** A fresh copy of the Line sample (the how-to's "open examples/line-sample", without touching the original). */
export function copySample() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-uat-')));
  fs.cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}

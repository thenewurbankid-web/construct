#!/usr/bin/env node
// Print a builder's exact prompt with SPEC.md filled in: line | plain | ui [cockpit-url].
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bench = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arm = process.argv[2] ?? 'line';
const file = { line: 'BUILDER-PROMPT.md', plain: 'BUILDER-PROMPT-PLAIN.md', ui: 'BUILDER-PROMPT-UI.md' }[arm];
if (!file) { console.error('usage: print-prompt.mjs line|plain|ui [cockpit-url]'); process.exit(2); }
const text = fs.readFileSync(path.join(bench, file), 'utf8');
const body = text.slice(text.indexOf('\n---\n') + 5);
process.stdout.write(body.replace('{{SPEC}}', fs.readFileSync(path.join(bench, 'SPEC.md'), 'utf8')).replace('{{COCKPIT_URL}}', process.argv[3] ?? 'http://localhost:3396'));

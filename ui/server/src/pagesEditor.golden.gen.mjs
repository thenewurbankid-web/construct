// Regenerates pagesEditor.golden.json from the CURRENT pagesEditor.mjs:
//   node ui/server/src/pagesEditor.golden.gen.mjs
// The committed golden was captured from the original Babel implementation (#173) BEFORE the
// typescript-estree migration -- only regenerate it deliberately, when an operation's intended
// behaviour changes.
import fs from 'node:fs';
import * as mod from './pagesEditor.mjs';
import { runGoldenCases } from './pagesEditor.golden.cases.mjs';

const out = new URL('./pagesEditor.golden.json', import.meta.url);
fs.writeFileSync(out, JSON.stringify(runGoldenCases(mod)) + '\n');
console.log('wrote', out.pathname);

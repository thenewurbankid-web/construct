// Print hardened Smith's description of a TS/TSX file (#942): node describe-cli.mjs <file> [--as-written]
// Env as for the tests: ATOMIC_CODEMOD_SOURCE_DIR, SMITH_SOURCE_DIR, LINE_LINKS_ALLOW_DRIFT=1. Canonical unless --as-written.
import fs from 'node:fs';
import { describe } from './smith.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: node describe-cli.mjs <file> [--as-written]'); process.exit(2); }
console.log(JSON.stringify(await describe(fs.readFileSync(file, 'utf8'), { canonical: !process.argv.includes('--as-written') }), null, 1));

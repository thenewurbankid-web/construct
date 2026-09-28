// Regenerates test/validate.characterization.golden.json from the CURRENT enforcers:
//   node test/validate.characterization.golden.gen.mjs
// #544 -- only regenerate deliberately, when a rule's intended behavior actually changes (e.g.
// a later phase of #545 that inlines a rule's real logic into the catalog and retires the old
// branch). Rules-2's rule-by-rule migration (#545) must NOT regenerate this file: it exists to
// prove the migration is byte-for-byte invisible.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, runCharacterization } from './validate.characterization.shared.mjs';

const out = path.join(REPO_ROOT, 'test', 'validate.characterization.golden.json');
fs.writeFileSync(out, `${JSON.stringify(runCharacterization(), null, 2)}\n`);
console.log('wrote', out);

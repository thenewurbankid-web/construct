// A gate worker process (isolated.mjs): runs the full C3 gate for one answer at a time, so an answer that allocates
// gigabytes or never ends takes down only this process, never the run.
import { readFileSync } from 'node:fs';
import { gateFor } from '../../pilot/library/run.mjs';
import { makeTypesCheck } from '../types/types.mjs';
import { REFERENCE_PATH } from '../../generator/generator.mjs';

const reference = JSON.parse(readFileSync(REFERENCE_PATH, 'utf8')).entries;
const byKey = new Map(reference.map((e) => [e.key, e]));
const typesCheck = makeTypesCheck(reference);

process.on('message', async ({ id, key, answer }) => {
  try {
    const verdict = await gateFor(byKey.get(key), { typesCheck })(answer);
    process.send({ id, verdict });
  } catch (e) {
    process.send({ id, error: String(e?.message ?? e).split('\n')[0] });
  }
});
process.send({ ready: true });

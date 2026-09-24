/**
 * A deterministic decision-trace fixture (#643): 40 answers to "what does this word mean" (a card noun question) and 10 to the
 * `q-shape` offer, all by a person, each with what the `rules` provider suggested; 30 of them carry `planValidated`. It is
 * written through the real store, so tests and the documentation show real files. Also three fake providers that BEAT, TIE and
 * LOSE to the `rules` baseline on it.
 *
 *   import { writeFixtureTraces, FAKE_PROVIDERS } from '../test-utils/decisionTraceFixture.mjs';
 *   await writeFixtureTraces(projectRoot, { stateDir });
 */
import { recordChoices, recordOutcomes } from '../packages/core/decision-trace-store.mjs';

/** The noun-question chooser id and its options, in offer order (`rules` always suggests the first). */
export const NOUN_CHOOSER = 'requirement.card.noun';
export const SHAPE_CHOOSER = 'requirement.placement.shape';
const NOUN_OPTIONS = ['entity', 'state', 'ui-part', 'external', 'ignore'];

/** What people chose for each word: 12 entity, 8 state, 20 ui-part. */
export const NOUN_TRUTH = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`widget${String(i + 1).padStart(2, '0')}`, i < 12 ? 'entity' : i < 20 ? 'state' : 'ui-part']));

const summaryOf = (id, question, options) => ({ id, question, options: options.map((o) => ({ id: o, label: o, enabled: true, why: `It is a ${o}.` })), chosen: null });

/** The fixture's choices in recording order, as `recordChoices` takes them. */
export function fixtureChoices() {
  const nouns = Object.entries(NOUN_TRUTH).map(([word, chosen], i) => ({ chooser: { id: NOUN_CHOOSER, question: `What does "${word}" mean here?` }, summary: summaryOf(`o${i + 1}`, `What does "${word}" mean here?`, NOUN_OPTIONS), chosen, by: 'person' }));
  const shapes = Array.from({ length: 10 }, (_, i) => ({ chooser: { id: SHAPE_CHOOSER, question: `How should the "items${i}" screen be built?` }, summary: summaryOf('q-shape', `How should the "items${i}" screen be built?`, ['list', 'scaffold']), chosen: i < 8 ? 'list' : 'scaffold', by: 'person' }));
  return [...nouns, ...shapes];
}

/**
 * Write the fixture to a project's trace file (through `recordChoices`, so suggestions and `accepted` are real) and mark 30
 * of the noun decisions as `planValidated`. Time starts at 2026-09-01T09:00:00Z and moves one minute per record.
 *
 * @param {string} root A project root (its architecture.yml, if any, must not switch traces off).
 * @param {{ stateDir: string }} options The state directory to write into.
 * @returns {Promise<string[]>} The ids of the recorded decisions, in order.
 */
export async function writeFixtureTraces(root, { stateDir }) {
  let minute = 0;
  const now = () => new Date(Date.UTC(2026, 8, 1, 9, minute++, 0)).toISOString();
  const ids = [];
  for (const choice of fixtureChoices()) ids.push(...(await recordChoices(root, [choice], { stateDir, now })).ids);
  recordOutcomes(root, ids.slice(0, 30).map((id) => ({ id, outcome: { planValidated: true } })), { stateDir, now });
  return ids;
}

const enabledOptions = (summary) => summary.options.filter((o) => o.enabled).map((o) => o.id);
const wordOf = (summary) => /"([^"]+)"/.exec(summary.question)?.[1];

/**
 * Three fake providers for the replay tests. `beater` knows the words (and abstains on two of them, so its coverage is below
 * 100%), `tier` answers exactly as `rules` does, `loser` always takes the last option.
 */
export const FAKE_PROVIDERS = {
  beater: { name: 'beater', version: '2', suggest: (s) => { const w = wordOf(s); if (w === 'widget39' || w === 'widget40') return null; const pick = NOUN_TRUTH[w] ?? 'list'; return { option: pick, reason: 'I know this word', runnerUp: null }; } },
  tier: { name: 'tier', version: '1', suggest: (s) => ({ option: enabledOptions(s)[0], reason: 'first', runnerUp: null }) },
  loser: { name: 'loser', version: '1', suggest: (s) => ({ option: enabledOptions(s).at(-1), reason: 'last', runnerUp: null }) },
};

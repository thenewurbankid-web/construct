/**
 * The synthetic dataset behind train-kit/fixtures (#647): 90 answers to "what does this word mean" (a card noun question with five
 * options) and 30 to the `q-shape` offer, all by a person, each recorded through the REAL store (so `rules` suggestions and
 * `accepted` are real), then exported through the REAL exporter with a fixed clock and a fixed project key, so the bundle is the same
 * bytes on every machine. The words follow learnable habits (a plural is usually data, a UI word a part of the screen) so the small
 * classifier has something to learn, and the rules baseline (always the first option) is beatable.
 *
 *   node test-utils/trainKitFixture.mjs --write     regenerate train-kit/fixtures/dataset (and only that; the golden files are made by the kit)
 *
 * A test regenerates the bundle into a temporary folder and compares it with the committed one, so the fixture cannot drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from './tmpdir.mjs';
import { recordChoices, readTraces } from '../packages/core/decision-trace-store.mjs';
import { buildDatasetBundle, DATASET_FILES } from '../packages/core/decision-dataset.mjs';

export const FIXTURE_NOW = '2026-09-25T12:00:00.000Z';
export const FIXTURE_KEY = 'fixtureproject00';
export const NOUN_CHOOSER = 'requirement.card.noun';
export const SHAPE_CHOOSER = 'requirement.placement.shape';

const NOUN_OPTIONS = ['entity', 'state', 'ui-part', 'external', 'ignore'];
const ENTITIES = ['invoices', 'orders', 'products', 'customers', 'payments', 'tickets', 'users', 'projects', 'messages', 'comments', 'reports', 'tasks', 'accounts', 'items', 'shipments', 'reviews', 'coupons', 'refunds', 'devices', 'events', 'articles', 'bookings', 'contacts', 'documents', 'employees', 'photos', 'playlists', 'quotes', 'recipes', 'sessions'];
const UI_PARTS = ['button', 'modal', 'sidebar', 'header', 'footer', 'panel', 'dropdown', 'tooltip', 'banner', 'menu', 'toolbar', 'carousel', 'tab', 'badge', 'avatar', 'dialog', 'popover', 'drawer', 'spinner', 'slider', 'toggle', 'card', 'chip', 'breadcrumb', 'stepper', 'accordion', 'snackbar', 'skeleton', 'divider', 'navbar'];
const STATES = ['cart', 'theme', 'locale', 'draft', 'selection', 'cursor', 'filter', 'zoom', 'sortorder', 'pagesize', 'darkmode', 'wizardstep', 'scrollpos', 'searchterm', 'focus', 'hover', 'expanded', 'collapsed', 'tabindex', 'formdirty', 'mute', 'volume', 'fontsize', 'language', 'timezone', 'viewmode', 'layout', 'sidebarstate', 'tourstep', 'toastqueue'];
const SHAPE_WORDS = ['invoices', 'orders', 'products', 'customers', 'payments', 'tickets', 'dashboard', 'settings', 'profile', 'checkout', 'billing', 'inbox', 'projects', 'reports', 'tasks', 'account', 'help', 'login', 'notes', 'search', 'events', 'users', 'gallery', 'landing', 'pricing', 'about', 'contacts', 'articles', 'wizard', 'onboarding'];

const summaryOf = (id, question, options) => ({ id, question, options: options.map((o) => ({ id: o, label: o, enabled: true, why: `It is a ${o}.` })), chosen: null });

/** The choices of the fixture, in recording order, as `recordChoices` takes them (a fixed interleaving, no random number). */
export function fixtureChoices() {
  const nouns = [];
  for (let i = 0; i < 30; i += 1) nouns.push({ word: ENTITIES[i], chosen: 'entity' }, { word: UI_PARTS[i], chosen: 'ui-part' }, { word: STATES[i], chosen: 'state' });
  const noun = nouns.map(({ word, chosen }, i) => ({ chooser: { id: NOUN_CHOOSER, question: `What does "${word}" mean here?` }, summary: summaryOf(`o${(i % 4) + 1}`, `What does "${word}" mean here?`, NOUN_OPTIONS), chosen, by: 'person' }));
  const shape = SHAPE_WORDS.map((word) => ({ chooser: { id: SHAPE_CHOOSER, question: `How should the "${word}" screen be built?` }, summary: summaryOf('q-shape', `How should the "${word}" screen be built?`, ['list', 'scaffold']), chosen: /s$/.test(word) ? 'list' : 'scaffold', by: 'person' }));
  return [...noun, ...shape];
}

/**
 * Record the fixture's choices in a project's trace store (through `recordChoices`, a clock that moves one minute per record from
 * 2026-09-01T09:00Z), so a test can export a real dataset whose hash equals the committed fixture's.
 *
 * @param {string} root A project root.
 * @param {string} stateDir The state directory to record into.
 * @returns {Promise<void>} Resolves when all choices are recorded.
 */
export async function writeTrainKitTraces(root, stateDir) {
  let minute = 0;
  const now = () => new Date(Date.UTC(2026, 8, 1, 9, minute++, 0)).toISOString();
  for (const choice of fixtureChoices()) await recordChoices(root, [choice], { stateDir, now });
}

/**
 * Build the fixture's dataset bundle files (name to text) through the real store and the real bundle builder.
 *
 * @returns {Promise<Record<string, string>>} `dataset.jsonl`, `schema.json`, `README.md` and `manifest.json`.
 */
export async function buildFixtureBundle() {
  const stateDir = makeTempDir('trainkit-fixture-state-');
  const root = makeTempDir('trainkit-fixture-project-');
  await writeTrainKitTraces(root, stateDir);
  const { decisions } = readTraces(root, { stateDir });
  const built = buildDatasetBundle([{ key: FIXTURE_KEY, decisions, enabled: true }], { now: FIXTURE_NOW, constructVersion: 'fixture' });
  if (!built.ok) throw new Error(built.message);
  return built.files;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.join(here, '..', 'train-kit', 'fixtures', 'dataset');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
  const files = await buildFixtureBundle();
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const name of DATASET_FILES) fs.writeFileSync(path.join(FIXTURE_DIR, name), files[name]);
  console.log(`wrote ${DATASET_FILES.length} files to ${path.relative(process.cwd(), FIXTURE_DIR)}`);
}

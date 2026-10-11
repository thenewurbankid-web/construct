// Train Line worlds: many small IMAGINARY Line projects (owner, 2026-10-11), generated deterministically from an id, so
// Line's rules (which do not change per project) can be trained on varied names without touching a real project.
// A world is only ever written into a scratch folder (materialize); nothing here writes inside a real project.
//
// Each world: a domain (shop, clinic, school, ...), a library (2 atoms, a molecule, sometimes an organism, 1-2 pages,
// 1-2 workflows, a fixture) and 2-4 features, each with a page and a component based on the library, sometimes a flow.
// The 'clean' variant passes `construct validate --profile line`; two variants plant one problem each for the fix cases:
//   cross-feature  a page of the second feature uses a component of the first (LINE-DIR)
//   missing-base   a component of the first feature has no base link and uses two library atoms (LINE-BASE)
// Worlds w30..w39 are held out: every case of a held-out world is scored by eval, none is used for retrieval.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** [plural, singular] nouns per domain; the first 2-4 become the features. */
const DOMAINS = Object.freeze([
  ['shop', [['catalog', 'product'], ['carts', 'cart'], ['orders', 'order'], ['returns', 'refund']]],
  ['clinic', [['patients', 'patient'], ['appointments', 'appointment'], ['invoices', 'invoice'], ['labs', 'specimen']]],
  ['school', [['courses', 'course'], ['students', 'student'], ['grades', 'grade'], ['timetable', 'lesson']]],
  ['crm', [['contacts', 'contact'], ['deals', 'deal'], ['tasks', 'task'], ['reports', 'report']]],
  ['lending', [['books', 'book'], ['loans', 'loan'], ['members', 'member']]],
  ['gym', [['classes', 'session'], ['trainers', 'trainer'], ['memberships', 'membership']]],
  ['hotel', [['rooms', 'room'], ['bookings', 'reservation'], ['guests', 'guest'], ['housekeeping', 'chore']]],
  ['restaurant', [['menu', 'dish'], ['tables', 'seating'], ['kitchen', 'ticket'], ['reservations', 'party']]],
  ['travel', [['trips', 'trip'], ['flights', 'flight'], ['itineraries', 'itinerary']]],
  ['events', [['tickets', 'pass'], ['venues', 'venue'], ['speakers', 'speaker'], ['sponsors', 'sponsor']]],
  ['logistics', [['shipments', 'shipment'], ['warehouses', 'warehouse'], ['drivers', 'driver']]],
  ['people', [['employees', 'employee'], ['payroll', 'payslip'], ['leave', 'absence']]],
  ['property', [['listings', 'listing'], ['viewings', 'viewing'], ['offers', 'offer'], ['tenants', 'tenant']]],
  ['farm', [['fields', 'field'], ['harvests', 'harvest'], ['machinery', 'tractor']]],
  ['garage', [['vehicles', 'vehicle'], ['repairs', 'repair'], ['parts', 'spare']]],
  ['cinema', [['films', 'film'], ['screenings', 'screening'], ['seats', 'seat']]],
  ['banking', [['accounts', 'account'], ['transfers', 'transfer'], ['statements', 'statement']]],
  ['charity', [['donors', 'donor'], ['campaigns', 'campaign'], ['volunteers', 'volunteer']]],
  ['newsroom', [['articles', 'article'], ['authors', 'author'], ['issues', 'edition'], ['subscribers', 'subscriber']]],
  ['vet', [['pets', 'pet'], ['clients', 'client'], ['visits', 'visit']]],
]);
const ATOMS = Object.freeze(['Button', 'Badge', 'Tag', 'Avatar', 'Chip', 'Pill', 'Icon']);
const MOLECULES = Object.freeze(['Card', 'Tile', 'Panel', 'Banner', 'Notice']);
const ORGANISMS = Object.freeze(['DataTable', 'Grid', 'Board']);
const PAGES = Object.freeze(['ListPage', 'DetailPage', 'FormPage', 'BoardPage']);
const FLOWS = Object.freeze(['checkout', 'approval', 'signup', 'booking', 'onboarding']);
const FIXTURES = Object.freeze(['profile', 'seed']);

export const WORLD_COUNT = 40;
export const HELDOUT_FROM = 30;
export const VARIANTS = Object.freeze(['clean', 'cross-feature', 'missing-base']);
export const SAMPLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../examples/line-sample');

/** World ids: w00..w39. */
export const WORLD_IDS = Object.freeze(Array.from({ length: WORLD_COUNT }, (_, i) => `w${String(i).padStart(2, '0')}`));
/** @param {string} id */
export const isHeldOut = (id) => Number(id.slice(1)) >= HELDOUT_FROM;

/** A small deterministic generator (mulberry32) so a world id always gives the same project. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list, n) => { const pool = [...list]; const out = []; while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]); return out; };
export const pascal = (s) => String(s).split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const camel = (s) => { const p = pascal(s); return p[0].toLowerCase() + p.slice(1); };

/**
 * The definition of one imaginary world (no files yet).
 * @param {string} id  "w00".."w39"
 */
export function worldSpec(id) {
  const n = Number(String(id).slice(1));
  if (!/^w\d\d$/.test(id) || n >= WORLD_COUNT) throw new Error(`There is no imaginary world ${id}.`);
  const r = rng(n * 7919 + 17);
  const [domain, nouns] = DOMAINS[n % DOMAINS.length];
  const featureCount = Math.min(nouns.length, 2 + Math.floor(r() * 3));
  const features = nouns.slice(0, featureCount).map(([plural, singular]) => ({ name: plural, singular }));
  const atoms = pick(r, ATOMS, 2);
  const molecule = pick(r, MOLECULES, 1)[0];
  const organism = r() < 0.5 ? pick(r, ORGANISMS, 1)[0] : null;
  const pages = pick(r, PAGES, 1 + Math.floor(r() * 2));
  const flows = pick(r, FLOWS, 1 + Math.floor(r() * 2));
  const fixture = pick(r, FIXTURES, 1)[0];
  const comps = [...atoms, molecule, ...(organism ? [organism] : [])];
  features.forEach((f, i) => {
    f.page = { name: `${pascal(f.name)}Page`, base: pages[i % pages.length] };
    f.component = { name: `${pascal(f.singular)}${atoms[i % atoms.length]}`, base: atoms[i % atoms.length] };
    f.flow = i % 2 === 0 ? { name: `${camel(f.singular)}Flow`, base: flows[i % flows.length] } : null;
  });
  // Domain words: everything the world names (features, nouns). Never stored in a case.
  const words = [...new Set(nouns.flatMap(([p, s]) => [p, s]))];
  return { id, domain, features, atoms, molecule, organism, pages, flows, fixture, comps, words };
}

const atomSrc = (name) => `export function ${name}({ text }: { text: string }) {\n  return <span className="${name.toLowerCase()}">{text}</span>;\n}\n`;
const moleculeSrc = (name, atom) => `import { ${atom} } from './${atom}';\n\nexport function ${name}({ title }: { title: string }) {\n  return (\n    <section>\n      <h2>{title}</h2>\n      <${atom} text="New" />\n    </section>\n  );\n}\n`;
const organismSrc = (name, molecule) => `import { ${molecule} } from './${molecule}';\n\nexport function ${name}({ first, second }: { first: string; second: string }) {\n  return (\n    <div>\n      <${molecule} title={first} />\n      <${molecule} title={second} />\n    </div>\n  );\n}\n`;
const pageSrc = (name, atom) => `import { ${atom} } from '../components/${atom}';\n\nexport function ${name}({ title, size, onMore }: { title: string; size?: number; onMore?: () => void }) {\n  return (\n    <main>\n      <h1>{title}</h1>\n      <${atom} text="More" />\n      <button type="button" onClick={onMore}>Show {size ?? 10} more</button>\n    </main>\n  );\n}\n`;
const flowSrc = (name) => `export type ${pascal(name)}State = 'start' | 'pending' | 'done';\n\nexport function next(state: ${pascal(name)}State): ${pascal(name)}State {\n  return state === 'start' ? 'pending' : 'done';\n}\n`;

/**
 * Every file of a world, root-relative, for one variant.
 * @param {string} id
 * @param {'clean'|'cross-feature'|'missing-base'} [variant]
 * @returns {Record<string, string>}
 */
export function worldFiles(id, variant = 'clean') {
  if (!VARIANTS.includes(variant)) throw new Error(`There is no world variant ${variant}.`);
  const w = worldSpec(id);
  /** @type {Record<string, string>} */
  const files = {
    'architecture.yml': 'version: 1\npreset: line\n',
    'library/README.md': '# Library\n\nShared, complete items every feature builds on.\n',
  };
  for (const a of w.atoms) files[`library/components/${a}.tsx`] = atomSrc(a);
  files[`library/components/${w.molecule}.tsx`] = moleculeSrc(w.molecule, w.atoms[0]);
  if (w.organism) files[`library/components/${w.organism}.tsx`] = organismSrc(w.organism, w.molecule);
  for (const p of w.pages) files[`library/pages/${p}.tsx`] = pageSrc(p, w.atoms[1]);
  for (const f of w.flows) files[`library/workflows/${f}.ts`] = flowSrc(f);
  files[`library/fixtures/${w.fixture}.json`] = `${JSON.stringify({ id: 'x1', name: 'Sam' }, null, 2)}\n`;
  for (const f of w.features) {
    const dir = `features/${f.name}`;
    files[`${dir}/spec.md`] = `# ${pascal(f.name)}\n\n## As a person, I want to see every ${f.singular}, so that I can act on it.\n\n- The ${f.page.name} lists every ${f.singular}.\n`;
    files[`${dir}/pages/${f.page.name}.tsx`] = `// @line-base pages/${f.page.base}\n// @line-route /${f.name}\nimport { ${f.page.base} } from '../../../library/pages/${f.page.base}';\n\nexport function ${f.page.name}() {\n  return <${f.page.base} title="${pascal(f.name)}" size={20} onMore={() => console.log('more ${f.name}')} />;\n}\n`;
    files[`${dir}/components/${f.component.name}.tsx`] = `// @line-base components/${f.component.base}\nimport { ${f.component.base} } from '../../../library/components/${f.component.base}';\n\nexport function ${f.component.name}() {\n  return <${f.component.base} text="${pascal(f.singular)}" />;\n}\n`;
    if (f.flow) {
      files[`${dir}/workflows/${f.flow.name}.ts`] = `// @line-base workflows/${f.flow.base}\nimport { next, type ${pascal(f.flow.base)}State } from '../../../library/workflows/${f.flow.base}';\n\nexport function advance(state: ${pascal(f.flow.base)}State): ${pascal(f.flow.base)}State {\n  return next(state);\n}\n`;
    }
  }
  const [f1, f2] = w.features;
  if (variant === 'cross-feature') {
    files[`features/${f2.name}/pages/${f2.page.name}.tsx`] = `// @line-base pages/${f2.page.base}\n// @line-route /${f2.name}\nimport { ${f2.page.base} } from '../../../library/pages/${f2.page.base}';\nimport { ${f1.component.name} } from '../../${f1.name}/components/${f1.component.name}';\n\nexport function ${f2.page.name}() {\n  return (\n    <>\n      <${f2.page.base} title="${pascal(f2.name)}" size={20} />\n      <${f1.component.name} />\n    </>\n  );\n}\n`;
  }
  if (variant === 'missing-base') {
    const [a0, a1] = w.atoms;
    files[`features/${f1.name}/components/${pascal(f1.singular)}Summary.tsx`] = `import { ${a0} } from '../../../library/components/${a0}';\nimport { ${a1} } from '../../../library/components/${a1}';\n\nexport function ${pascal(f1.singular)}Summary() {\n  return (\n    <div>\n      <${a0} text="${pascal(f1.singular)}" />\n      <${a1} text="Open" />\n    </div>\n  );\n}\n`;
  }
  return files;
}

/** Every identifier and domain word of a world (for the delexicalization test and the domain map). */
export function worldWords(id) {
  const w = worldSpec(id);
  const files = worldFiles(id, 'cross-feature');
  const names = Object.keys({ ...files, ...worldFiles(id, 'missing-base') }).filter((p) => p.startsWith('features/') || p.startsWith('library/'))
    .map((p) => path.posix.basename(p).replace(/\.(tsx|ts|json|md)$/, '')).filter((n) => !['README', 'spec'].includes(n));
  return [...new Set([...w.words, ...names, ...w.features.map((f) => f.name)])];
}

/**
 * Write a world (or the Line sample) into a NEW scratch folder and return its path. The caller removes it.
 * @param {{kind: 'corpus', id: string, variant?: string}|{kind: 'sample'}} world
 * @returns {string}
 */
export function materialize(world) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-train-world-')));
  if (world.kind === 'sample') {
    fs.cpSync(SAMPLE_DIR, dir, { recursive: true, filter: (src) => !/[\\/](node_modules|line)([\\/]|$)/.test(path.relative(SAMPLE_DIR, src) ? `/${path.relative(SAMPLE_DIR, src)}` : '') });
    return dir;
  }
  const files = worldFiles(world.id, /** @type {any} */ (world.variant ?? 'clean'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

/** A world's key for caches and the API: "sample" or "w07:clean". */
export const worldKey = (world) => (world.kind === 'sample' ? 'sample' : `${world.id}:${world.variant ?? 'clean'}`);
/** @param {string} key @returns {{kind: 'corpus', id: string, variant: string}|{kind: 'sample'}} */
export function worldOf(key) {
  if (key === 'sample') return { kind: 'sample' };
  const [id, variant = 'clean'] = String(key).split(':');
  worldSpec(id);
  if (!VARIANTS.includes(variant)) throw new Error(`There is no world variant ${variant}.`);
  return { kind: 'corpus', id, variant };
}

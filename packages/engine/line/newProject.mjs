// cu7: start a new Line project (contract.mjs NewLineProjectRequest, POST /api/line/new-project). The generator is
// pure (planNewLineProject: the starter files as a StagedChange); createLineProject makes the one new folder and
// lands the files ONLY through applyChange (Construct's transactional writer, gated by the new project's own
// validate profile, which is Line because the staged architecture.yml says `preset: line`). A refusal throws a
// LineOpError before anything is written; a refused commit removes the folder it just made, so nothing is kept.
//
// What a new project holds (the layout of examples/line-sample, with a small generic starter library):
//   architecture.yml            version 1, preset: line
//   README.md                   what the folders are for
//   library/README.md           the library: complete items every feature builds on
//   library/components/         Button and TextField (atoms), Card (a molecule built on Button)
//   library/pages/ListPage.tsx  a list page built on Card and Button
//   library/fixtures/item.json  one sample record
//   features/<first>/spec.md    "## Story 1" with one acceptance point to fill in
//   features/<first>/pages/.gitkeep   the empty pages folder the first page will go in
//   line/README.md              Line's own state folder (plans, memory), written only by the writer
// With `library: "primitives"` the library is @line/primitives' 40 canonical primitives (Radix + Tailwind, each with
// its contract and test kit in that package) instead of the small starter, a ListPage built on them, and a package.json
// naming the npm packages they need.
import fs from 'node:fs';
import path from 'node:path';
import { LineOpError } from './contract.mjs';
import { applyChange } from './ops.mjs';
import { primitiveLibraryFiles, PRIMITIVE_DEPENDENCIES } from '@line/primitives/library';

/** A project folder name: one segment (the Cockpit's folder-name rule: no separators, no "..", no leading dot). */
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** A feature name, as everywhere in Line (ops.mjs FEATURE_NAME). */
const FEATURE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const MAX_NAME_LENGTH = 100;

/** The starter library, root-relative. Kept generic so any app can start from it. */
export const STARTER_LIBRARY = Object.freeze({
  'library/README.md': '# Library\n\nShared, complete items every feature builds on. A feature item is based on one of these (its `@line-base` link).\n',
  'library/components/Button.tsx': '// @line-level atom\nexport function Button({ label, onClick }: { label: string; onClick?: () => void }) {\n  return <button type="button" onClick={onClick}>{label}</button>;\n}\n',
  'library/components/TextField.tsx': '// @line-level atom\nexport function TextField({ label, value, onChange }: { label: string; value: string; onChange?: (value: string) => void }) {\n  return (\n    <label>\n      {label}\n      <input type="text" value={value} onChange={(e) => onChange?.(e.target.value)} />\n    </label>\n  );\n}\n',
  'library/components/Card.tsx': "// @line-level molecule\nimport { Button } from './Button';\n\nexport function Card({ title, action }: { title: string; action: string }) {\n  return (\n    <section>\n      <h2>{title}</h2>\n      <Button label={action} />\n    </section>\n  );\n}\n",
  'library/pages/ListPage.tsx': "import { Button } from '../components/Button';\nimport { Card } from '../components/Card';\n\nexport function ListPage({ title, first, onMore }: { title: string; first: string; onMore?: () => void }) {\n  return (\n    <main>\n      <h1>{title}</h1>\n      <Card title={first} action=\"Open\" />\n      <Button label=\"Show more\" onClick={onMore} />\n    </main>\n  );\n}\n",
  'library/fixtures/item.json': '{\n  "id": "item-1",\n  "name": "First item"\n}\n',
});

/** The starting libraries a new project can take. */
export const LIBRARY_CHOICES = Object.freeze(['starter', 'primitives']);

/** The primitives' list page: the starter's ListPage, built on the primitives. */
const PRIMITIVES_LIST_PAGE = [
  "import { Button } from '../components/Button';",
  "import { Card } from '../components/Card';",
  "import { Stack } from '../components/Stack';",
  "import { Text } from '../components/Text';",
  '',
  'export function ListPage({ title, first, onMore }: { title: string; first: string; onMore?: () => void }) {',
  '  return (',
  '    <main>',
  '      <Stack gap="4">',
  '        <Text as="h1">{title}</Text>',
  '        <Card title={first} />',
  '        <Button label="Show more" onClick={onMore} />',
  '      </Stack>',
  '    </main>',
  '  );',
  '}',
  '',
].join('\n');

/**
 * The library files a new project starts with.
 * @param {string} name The project name (for package.json).
 * @param {string} library The chosen library (LIBRARY_CHOICES).
 * @returns {Record<string, string>} Root-relative path -> file text.
 */
function libraryFiles(name, library) {
  if (library !== 'primitives') return { ...STARTER_LIBRARY };
  const pkg = { name: name.toLowerCase(), private: true, dependencies: { ...PRIMITIVE_DEPENDENCIES } };
  return {
    ...primitiveLibraryFiles(),
    'library/pages/ListPage.tsx': PRIMITIVES_LIST_PAGE,
    'library/fixtures/item.json': STARTER_LIBRARY['library/fixtures/item.json'],
    'package.json': `${JSON.stringify(pkg, null, 2)}\n`,
  };
}

/**
 * One plain sentence for a name that cannot be a project folder, or null.
 * @param {any} name The proposed project name.
 * @returns {string | null}
 */
export function projectNameProblem(name) {
  if (typeof name !== 'string' || name.trim() === '') return 'Give the project a name.';
  const n = name.trim();
  if (n.length > MAX_NAME_LENGTH) return 'That project name is too long; use at most 100 characters.';
  if (/[\\/]/.test(n) || n.includes('..')) return `"${n}" is not a project name: a name is one folder, without slashes or "..".`;
  if (!PROJECT_NAME.test(n) || n.endsWith('.')) return `"${n}" is not a project name; use letters, digits, "-" and "_", starting with a letter or digit.`;
  return null;
}

/**
 * One plain sentence for a name that cannot be a feature, or null.
 * @param {any} name The proposed feature name.
 * @returns {string | null}
 */
export function featureNameProblem(name) {
  if (typeof name !== 'string' || name.trim() === '') return 'Name the first feature, for example "catalog".';
  const n = name.trim();
  if (n.length > MAX_NAME_LENGTH || !FEATURE_NAME.test(n)) return `"${n}" is not a feature name; use letters, digits, "-" and "_", starting with a letter or digit.`;
  return null;
}

/**
 * The starter files of a new Line project (pure: nothing is written).
 * @param {import('./contract.mjs').NewLineProjectRequest} req
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} BAD_NAME or BAD_FEATURE.
 */
export function planNewLineProject(req) {
  const nameProblem = projectNameProblem(req?.name);
  if (nameProblem) throw new LineOpError(nameProblem, 'BAD_NAME');
  const featureProblem = featureNameProblem(req?.firstFeature);
  if (featureProblem) throw new LineOpError(featureProblem, 'BAD_FEATURE');
  const library = req.library ?? 'starter';
  if (!LIBRARY_CHOICES.includes(library)) throw new LineOpError(`"${library}" is not a starting library; choose ${LIBRARY_CHOICES.join(' or ')}.`, 'BAD_LIBRARY');
  const name = req.name.trim();
  const feature = req.firstFeature.trim();
  const files = {
    'architecture.yml': 'version: 1\npreset: line\n',
    'README.md': `# ${name}\n\nA Line project. \`library/\` holds the shared items every feature builds on; \`features/<name>/\` holds one feature each, with its spec.md; \`line/\` is Line's own state.\n\nCheck it: \`construct validate --profile line\`.\n`,
    ...libraryFiles(name, library),
    [`features/${feature}/spec.md`]: `# ${feature}\n\n## Story 1\n\n- Describe one thing a person can do in ${feature}.\n`,
    [`features/${feature}/pages/.gitkeep`]: '',
    'line/README.md': "# Line state\n\nLine's own plans and memory for this project. Only Construct's writer changes this folder.\n",
  };
  return {
    summary: `Creates the Line project ${name} with ${library === 'primitives' ? 'the Line primitives library' : 'a starter library'} and the empty feature ${feature}.`,
    files: Object.entries(files).map(([p, content]) => ({ path: p, content })),
  };
}

/**
 * Make `<parentDir>/<name>` and write the starter files into it through the writer.
 * @param {string} parentDir Absolute path of an existing folder (the caller has already contained it in the workspace).
 * @param {import('./contract.mjs').NewLineProjectRequest} req
 * @returns {import('./contract.mjs').NewLineProjectResult}
 * @throws {LineOpError} BAD_NAME, BAD_FEATURE, NO_PARENT or NAME_TAKEN (nothing written).
 */
export function createLineProject(parentDir, req) {
  const staged = planNewLineProject(req);
  if (!fs.statSync(parentDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new LineOpError('The folder to put the project in does not exist; pick another folder.', 'NO_PARENT');
  }
  const name = req.name.trim();
  const dir = path.join(parentDir, name);
  const taken = () => new LineOpError(`There is already something called "${name}" in that folder; choose another name.`, 'NAME_TAKEN');
  if (fs.lstatSync(dir, { throwIfNoEntry: false }) !== undefined) throw taken();
  // Non-recursive: a race for the same name has exactly one winner, and nothing already there is ever touched.
  try { fs.mkdirSync(dir); } catch (e) {
    if (/** @type {any} */ (e).code === 'EEXIST') throw taken();
    throw new LineOpError('The project folder could not be created; nothing was changed.', 'CREATE_FAILED');
  }
  const result = applyChange(dir, staged);
  if (!result.ok) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ...result, dir: null };
  }
  return { ...result, sentence: `Created the Line project ${name} with the empty feature ${req.firstFeature.trim()}.`, dir };
}

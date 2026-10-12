// Line Cockpit mock (contract.mjs): an in-memory LineOps over a small fixed project, so the server
// router (T4) and the screens (T5, T6) can be built and tested before the real model and operations
// land. It keeps the contract's rules: plans are pure, applyChange is the only thing that changes
// state, a NEW cross-feature import is refused with a LINE-DIR finding (old problems never block), and every message is a sentence.
import { LineOpError } from './contract.mjs';
import { groupItems, summarySentences, parseSpec, coverSpec, testTitles } from './featureText.mjs';
import { mockFragmentsOf, mockHash } from './mockFragments.mjs';
import { createMockWorkflows } from './mockWorkflows.mjs';

const LIB = 'library';
const FEAT = 'features';
/** Folder names the mock treats as already taken in any parent folder. */
const TAKEN = new Set(['taken']);

/** The sample project's files (root-relative path -> source), the same shape as examples/line-sample. */
export const MOCK_FILES = Object.freeze({
  'library/components/Button.tsx': 'export function Button(props: { label: string }) { return <button>{props.label}</button>; }\n',
  'library/components/TextField.tsx': 'export function TextField(props: { value: string }) { return <input value={props.value} />; }\n',
  'library/components/Dialog.tsx': "import { Button } from './Button';\nexport function Dialog(props: { title: string }) { return <div role=\"dialog\"><h2>{props.title}</h2><Button label=\"OK\" /></div>; }\n",
  'library/pages/ListPage.tsx': 'export default function ListPage(props: { title: string }) { return <main><h1>{props.title}</h1></main>; }\n',
  'features/orders/spec.md': '# Orders\n\n## As a shopper, I want to see my orders, so that I know what I bought.\n\n- The OrdersPage lists every order.\n- A shopper can cancel an order before it ships.\n',
  'features/orders/components/OrderButton.tsx': "// @line-base components/Button\nimport { Button } from '../../../library/components/Button';\nexport function OrderButton() { return <Button label=\"Order\" />; }\n",
  'features/orders/pages/OrdersPage.tsx': "// @line-base pages/ListPage\nimport ListPage from '../../../library/pages/ListPage';\nexport default function OrdersPage() { return <ListPage title=\"Orders\" onMore={() => alert('More orders')} />; }\n",
  'features/billing/spec.md': '# Billing\n',
  'features/billing/pages/InvoicesPage.tsx': "// @line-base pages/ListPage\nimport ListPage from '../../../library/pages/ListPage';\nimport { OrderButton } from '../../orders/components/OrderButton';\nexport default function InvoicesPage() { return <ListPage title=\"Invoices\" />; }\n",
});

const nameOf = (file) => file.split('/').pop().replace(/\.[^.]+$/, '');
const baseOf = (src) => (src.match(/@line-base\s+([^\s*]+)/) || [])[1] ?? null;

/**
 * Findings the mock "validate" reports: cross-feature imports (LINE-DIR) and missing bases (LINE-BASE).
 * @param {Record<string, string|null>} files
 * @returns {import('./contract.mjs').LineFinding[]}
 */
function findingsOf(files) {
  /** @type {import('./contract.mjs').LineFinding[]} */
  const out = [];
  for (const [file, src] of Object.entries(files)) {
    const m = file.match(/^features\/([^/]+)\/(components|pages|workflows|fixtures)\//);
    if (!m || src === null) continue;
    src.split('\n').forEach((text, i) => {
      const other = text.match(/from '\.\.\/\.\.\/([^/.]+)\//);
      if (other && other[1] !== m[1]) {
        const imported = text.match(/from '\.\.\/\.\.\/([^/]+)\/(components|pages|workflows|fixtures)\/(\w+)'/);
        const fixes = /** @type {import('./contract.mjs').LineFix[]} */ (imported ? [{ id: 'LINE-DIR/promote', sentence: `Move ${imported[3]} from feature ${imported[1]} into the library and point every import at the library copy.`, rank: 1, step: { tool: 'line.promote', args: { featureItemId: `${imported[1]}/${imported[2]}/${imported[3]}` } } }] : []);
        out.push({ sentence: `Feature "${m[1]}" imports from feature "${other[1]}"; a feature may use only the library, so promote that item to ${LIB}/ and import it from there.`, rule: 'LINE-DIR', severity: 'error', file, line: i + 1, key: `LINE-DIR|${file}|${i + 1}`, fixes });
      }
    });
    if (!baseOf(src)) {
      const lib = (src.match(new RegExp(`from '(?:\\.\\./)+${LIB}/${m[2]}/(\\w+)'`)) || [])[1];
      const fixes = /** @type {import('./contract.mjs').LineFix[]} */ (lib
        ? [{ id: `LINE-BASE/set-base:${m[2]}/${lib}`, sentence: `Base ${nameOf(file)} on the library ${lib}, which it already uses.`, rank: 1, step: { tool: 'line.setBase', args: { file, libraryId: `${m[2]}/${lib}` } } }]
        : [{ id: 'LINE-BASE/create-library-item', sentence: `Create a library item for ${nameOf(file)} to be based on first.`, rank: 1, step: null }]);
      out.push({ sentence: `The feature item "${file}" has no library base; add one "@line-base ${m[2]}/<Name>" comment naming the library item it is based on.`, rule: 'LINE-BASE', severity: 'error', file, line: 1, key: `LINE-BASE|${file}|1`, fixes });
    }
  }
  return out;
}

function levelOf(files, file) {
  const libImports = [...files[file].matchAll(/from '\.\/([A-Za-z]+)'/g)].map((m) => m[1]);
  if (!libImports.length) return 'atom';
  return libImports.every((n) => !/from '\.\//.test(files[`${LIB}/components/${n}.tsx`] ?? '')) ? 'molecule' : 'organism';
}

/**
 * A fresh mock. Each instance keeps its own copy of the files, so tests do not leak into each other.
 * @param {{files?: Record<string, string>}} [opts]
 * @returns {import('./contract.mjs').LineOps & {files: () => Record<string, string>}}
 */
export function createMockLineOps({ files: initial = MOCK_FILES } = {}) {
  /** @type {Record<string, string>} */
  const files = { ...initial };
  /** Projects made by createLineProject (absolute dir -> files). */
  const projects = new Map();
  const { landed, ...workflowOps } = createMockWorkflows({ files, project: () => readLineProject() }); // cw1: library workflows + the four workflow plans
  let folder = ''; // cu6: the workspace folder ('' = whole project), as line/workspace.json would hold it

  /** @returns {import('./contract.mjs').LineProject} */
  function readLineProject() {
    const findings = findingsOf(files);
    const paths = Object.keys(files).sort();
    const library = paths.filter((f) => f.startsWith(`${LIB}/`)).map((file) => {
      const [, kind] = file.split('/');
      const name = nameOf(file);
      const id = `${kind}/${name}`;
      const usedBy = paths.filter((f) => f.startsWith(`${FEAT}/`) && baseOf(files[f]) === id).map((f) => ({ feature: f.split('/')[1], file: f }));
      return { id, kind, name, file, ...(kind === 'components' ? { level: levelOf(files, file) } : {}), usedBy };
    });
    const libIds = new Set(library.map((l) => l.id));
    const names = [...new Set(paths.filter((f) => f.startsWith(`${FEAT}/`)).map((f) => f.split('/')[1]))];
    const features = names.map((name) => ({
      name,
      spec: files[`${FEAT}/${name}/spec.md`] !== undefined ? `${FEAT}/${name}/spec.md` : null,
      items: paths.filter((f) => f.startsWith(`${FEAT}/${name}/`) && f.split('/').length === 4).map((file) => {
        const own = findings.filter((x) => x.file === file);
        const value = baseOf(files[file]);
        const kind = file.split('/')[2];
        return { id: `${name}/${kind}/${nameOf(file)}`, kind, name: nameOf(file), feature: name, file, base: { value, libraryId: value && libIds.has(value) ? value : null }, status: own.length ? 'problem' : 'ok', findings: own };
      }),
    }));
    return /** @type {import('./contract.mjs').LineProject} */ ({ isLine: true, layout: { library: LIB, features: FEAT, state: 'line' }, library, features, findings });
  }

  /** @returns {import('./contract.mjs').LineFeatureDetail} */
  function readLineFeature(_root, name) {
    const p = readLineProject();
    const feature = p.features.find((f) => f.name === name);
    if (!feature) throw new LineOpError(`There is no feature "${name}"; pick one from the list.`, 'UNKNOWN_ITEM');
    const uses = new Map(feature.items.map((it) => {
      const dir = it.file.split('/').slice(0, -1);
      const list = [...files[it.file].matchAll(/from '(\.[^']+)'/g)].map((m) => {
        const segs = [...dir];
        for (const s of m[1].split('/')) { if (s === '..') segs.pop(); else if (s !== '.') segs.push(s); }
        const target = segs.join('/');
        const used = nameOf(target);
        if (target.startsWith(`${LIB}/`)) return `${target.split('/')[1]}/${used}` === it.base.libraryId ? null : { name: used, area: 'library' };
        const other = target.split('/')[1];
        return other === name ? { name: used, area: 'same' } : { name: used, area: 'feature', feature: other };
      }).filter(Boolean);
      return [it.id, /** @type {any} */ (list)];
    }));
    const prefix = `${FEAT}/${name}/`;
    const tests = Object.keys(files).filter((f) => f.startsWith(prefix) && /\.(test|spec)\./.test(f)).flatMap((f) => testTitles(files[f]));
    const spec = feature.spec ? { file: feature.spec, stories: coverSpec(parseSpec(files[feature.spec]), { itemNames: feature.items.map((i) => i.name), testTitles: tests }) } : null;
    return {
      name,
      items: groupItems(feature.items),
      summary: { sentences: summarySentences(name, feature.items, new Map(p.library.map((l) => [l.id, l.name])), uses), via: 'static' },
      spec,
      findings: p.findings.filter((f) => f.file.startsWith(prefix)),
    };
  }

  return {
    files: () => ({ ...files }),
    readLineProject,
    readLineFeature,
    ...workflowOps,
    planBaseOn(_root, { libraryId, feature, name }) {
      const lib = /** @type {import('./contract.mjs').LibraryItem|undefined} */ (readLineProject().library.find((l) => l.id === libraryId));
      if (!lib) throw new LineOpError(`There is no library item "${libraryId}"; pick one from the library.`, 'UNKNOWN_ITEM');
      if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new LineOpError(`"${name}" is not a component name; use a capitalised name such as OrderButton.`, 'BAD_NAME');
      const path = `${FEAT}/${feature}/${lib.kind}/${name}.tsx`;
      if (files[path] !== undefined) throw new LineOpError(`Feature "${feature}" already has ${name}; pick another name.`, 'NAME_TAKEN');
      const content = `// @line-base ${libraryId}\nimport { ${lib.name} } from '../../../${lib.file.replace(/\.tsx$/, '')}';\nexport function ${name}() { return <${lib.name} />; }\n`;
      return { summary: `Creates ${name} in feature ${feature}, based on the library ${lib.name}.`, files: [{ path, content }] };
    },
    planPromote(_root, { featureItemId }) {
      const item = readLineProject().features.flatMap((f) => f.items).find((i) => i.id === featureItemId);
      if (!item) throw new LineOpError(`There is no feature item "${featureItemId}".`, 'UNKNOWN_ITEM');
      const dest = `${LIB}/${item.kind}/${item.name}.tsx`;
      if (files[dest] !== undefined) throw new LineOpError(`The library already has ${item.name}; rename it before promoting.`, 'NAME_TAKEN');
      const moved = files[item.file].replace(/^\/\/ @line-base .*\n/, '').replace(/'\.\.\/\.\.\/\.\.\/library\/[^/]+\//g, "'../");
      const users = Object.entries(files).filter(([f, s]) => f !== item.file && s.includes(item.file.replace(/^features\/[^/]+\//, '').replace(/\.tsx$/, '')));
      const rewritten = users.map(([f, s]) => ({ path: f, content: s.replace(/'\.\.\/\.\.\/[^/]+\/components\/(\w+)'/g, "'../../../library/components/$1'") }));
      return { summary: `Moves ${item.name} from feature ${item.feature} into the library and points its users at the library copy.`, files: [{ path: dest, content: moved }, { path: item.file, content: null }, ...rewritten] };
    },
    planSetProp(_root, { file, prop, value }) {
      if (files[file] === undefined) throw new LineOpError(`There is no page "${file}".`, 'UNKNOWN_ITEM');
      const re = new RegExp(`${prop}="[^"]*"`);
      if (!re.test(files[file])) throw new LineOpError(`This part has no ${prop} to change.`, 'UNKNOWN_PROP');
      return { summary: `Sets ${prop} to "${value}" on the page ${nameOf(file)}.`, files: [{ path: file, content: files[file].replace(re, `${prop}="${value}"`) }] };
    },
    readWorkspace(root) { return { root, folder, readOnly: true }; },
    setWorkspace(root, { folder: next }) {
      const f = String(next ?? '').replace(/\/+$/, '');
      if (f.split('/').some((s) => s === '..' || s === '.') || f.startsWith('/')) throw new LineOpError(`"${next}" is not a folder inside the project; pick one from the project's folders.`, 'BAD_FOLDER');
      if (f && !Object.keys(files).some((p) => p.startsWith(`${f}/`))) throw new LineOpError(`There is no folder "${f}" in the project; pick an existing folder.`, 'BAD_FOLDER');
      folder = f;
      return { root, folder, readOnly: true };
    },
    /** Like fixes.mjs applyFix: find the finding by key, plan its fix (promote or set-base), apply it. */
    applyFix(root, { findingKey, fixId }) {
      const finding = findingsOf(files).find((x) => x.key === findingKey);
      if (!finding) throw new LineOpError('That problem is no longer reported; reload the project to see what is left.', 'UNKNOWN_FINDING');
      const fix = (finding.fixes || []).find((x) => x.id === fixId);
      if (!fix) throw new LineOpError('That fix no longer applies to this problem; reload the project and pick again.', 'UNKNOWN_FIX');
      if (!fix.step) throw new LineOpError(fix.sentence, 'NO_STEP');
      if (fix.step.tool === 'line.promote') return this.applyChange(root, this.planPromote(root, /** @type {any} */ (fix.step.args)));
      const { file, libraryId } = /** @type {any} */ (fix.step.args);
      return this.applyChange(root, { summary: `Bases ${nameOf(file)} on the library ${libraryId.split('/')[1]}.`, files: [{ path: file, content: `// @line-base ${libraryId}\n${files[file]}` }] });
    },
    /** @returns {import('./contract.mjs').FragmentList} */
    listFragments(_root, file) {
      if (files[file] === undefined) throw new LineOpError(`There is no file "${file}" in this project.`, 'UNKNOWN_ITEM');
      return { file, contentHash: mockHash(files[file]), fragments: mockFragmentsOf(files[file], file) };
    },
    /** @returns {import('./contract.mjs').StagedChange} */
    planSetFragment(_root, { file, fragmentId, code, contentHash } = /** @type {any} */ ({})) {
      if (files[file] === undefined) throw new LineOpError(`There is no file "${file}" in this project.`, 'UNKNOWN_ITEM');
      const src = files[file];
      if (contentHash !== mockHash(src)) throw new LineOpError('This file changed since you opened the code; reload it and try again.', 'STALE');
      const frag = mockFragmentsOf(src, file).find((f) => f.id === fragmentId);
      if (!frag) throw new LineOpError('That piece of code is no longer there; reload the page and pick it again.', 'UNKNOWN_ITEM');
      const count = (re) => (String(code).match(re) || []).length;
      if (typeof code !== 'string' || !code.trim() || /[{}]/.test(code) || count(/\(/g) !== count(/\)/g)) {
        throw new LineOpError('This code is not a single valid expression, so nothing was saved.', 'BAD_CODE', 'The mock checks only for balanced round brackets and no curly braces.');
      }
      return { summary: `Changes the code for "${frag.label}" in ${nameOf(file)}.`, files: [{ path: file, content: src.slice(0, frag.range.start) + code + src.slice(frag.range.end) }] };
    },
    /** A new Line project's starter files (cu7; the real one is newProject.mjs): a smaller starter library. */
    planNewLineProject(req) {
      const name = typeof req?.name === 'string' ? req.name.trim() : '';
      const feature = typeof req?.firstFeature === 'string' ? req.firstFeature.trim() : '';
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes('..')) throw new LineOpError(`"${name}" is not a project name: a name is one folder, without slashes or "..".`, 'BAD_NAME');
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(feature)) throw new LineOpError(`"${feature}" is not a feature name; use letters, digits, "-" and "_", starting with a letter or digit.`, 'BAD_FEATURE');
      if (req.library !== undefined && !['starter', 'primitives'].includes(req.library)) throw new LineOpError(`"${req.library}" is not a starting library; choose starter or primitives.`, 'BAD_LIBRARY');
      return {
        summary: `Creates the Line project ${name} with a starter library and the empty feature ${feature}.`,
        files: [
          { path: 'architecture.yml', content: 'version: 1\npreset: line\n' },
          { path: `${LIB}/components/Button.tsx`, content: MOCK_FILES[`${LIB}/components/Button.tsx`] },
          { path: `${FEAT}/${feature}/spec.md`, content: `# ${feature}\n\n## Story 1\n\n- Describe one thing a person can do in ${feature}.\n` },
          { path: `${FEAT}/${feature}/pages/.gitkeep`, content: '' },
        ],
      };
    },
    /** @returns {import('./contract.mjs').NewLineProjectResult} */
    createLineProject(parentDir, req) {
      const staged = this.planNewLineProject(req);
      const dir = `${parentDir.replace(/\/+$/, '')}/${req.name.trim()}`;
      if (projects.has(dir) || TAKEN.has(req.name.trim())) throw new LineOpError(`There is already something called "${req.name.trim()}" in that folder; choose another name.`, 'NAME_TAKEN');
      projects.set(dir, Object.fromEntries(staged.files.map((f) => [f.path, f.content ?? ''])));
      return { ok: true, sentence: `Created the Line project ${req.name.trim()} with the empty feature ${req.firstFeature.trim()}.`, files: staged.files.map((f) => f.path), findings: [], dir };
    },
    /** The mock's created projects (absolute dir -> files), for tests. */
    .../** @type {any} */ ({ projects: () => Object.fromEntries([...projects].map(([d, f]) => [d, { ...f }])) }),
    /** @returns {import('./contract.mjs').ApplyResult} */
    applyChange(_root, change) {
      const outside = change.files.find((x) => folder && x.path !== folder && !x.path.startsWith(`${folder}/`));
      if (outside) {
        return { ok: false, sentence: `Nothing was saved: ${outside.path} is outside your workspace folder ${folder}; it stays read-only.`, files: [], code: 'OUTSIDE_WORKSPACE',
          findings: [{ sentence: `${outside.path} is outside your workspace folder ${folder}; change the workspace folder to edit it.`, rule: 'OUTSIDE_WORKSPACE', severity: 'error', file: outside.path, line: 1 }] };
      }
      const next = { ...files };
      for (const f of change.files) { if (f.content === null) delete next[f.path]; else next[f.path] = f.content; }
      const touched = new Set(change.files.map((f) => f.path));
      // Like the real writer (ops.mjs onlyNewProblems): only problems the change adds block it; old ones stay.
      const sameProblem = (x) => `${x.rule}|${x.file}|${x.sentence}`;
      const before = new Set(findingsOf(files).map(sameProblem));
      const findings = findingsOf(next).filter((x) => touched.has(x.file) && !before.has(sameProblem(x)));
      if (findings.some((x) => x.severity === 'error')) {
        return { ok: false, sentence: `Nothing was saved: ${findings[0].sentence.charAt(0).toLowerCase()}${findings[0].sentence.slice(1)}`, files: [], findings };
      }
      for (const k of Object.keys(files)) delete files[k];
      Object.assign(files, next);
      landed(change);
      return { ok: true, sentence: `Saved. ${change.summary}`, files: [...touched], findings: [] };
    },
  };
}

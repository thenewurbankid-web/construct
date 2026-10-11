// Line Cockpit mock (contract.mjs): an in-memory LineOps over a small fixed project, so the server
// router (T4) and the screens (T5, T6) can be built and tested before the real model and operations
// land. It keeps the contract's rules: plans are pure, applyChange is the only thing that changes
// state, a NEW cross-feature import is refused with a LINE-DIR finding (old problems never block), and every message is a sentence.
import { LineOpError } from './contract.mjs';

const LIB = 'library';
const FEAT = 'features';

/** The sample project's files (root-relative path -> source), the same shape as examples/line-sample. */
export const MOCK_FILES = Object.freeze({
  'library/components/Button.tsx': 'export function Button(props: { label: string }) { return <button>{props.label}</button>; }\n',
  'library/components/TextField.tsx': 'export function TextField(props: { value: string }) { return <input value={props.value} />; }\n',
  'library/components/Dialog.tsx': "import { Button } from './Button';\nexport function Dialog(props: { title: string }) { return <div role=\"dialog\"><h2>{props.title}</h2><Button label=\"OK\" /></div>; }\n",
  'library/pages/ListPage.tsx': 'export default function ListPage(props: { title: string }) { return <main><h1>{props.title}</h1></main>; }\n',
  'features/orders/spec.md': '# Orders\n',
  'features/orders/components/OrderButton.tsx': "// @line-base components/Button\nimport { Button } from '../../../library/components/Button';\nexport function OrderButton() { return <Button label=\"Order\" />; }\n",
  'features/orders/pages/OrdersPage.tsx': "// @line-base pages/ListPage\nimport ListPage from '../../../library/pages/ListPage';\nexport default function OrdersPage() { return <ListPage title=\"Orders\" />; }\n",
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
        out.push({ sentence: `Feature "${m[1]}" imports from feature "${other[1]}"; a feature may use only the library, so promote that item to ${LIB}/ and import it from there.`, rule: 'LINE-DIR', severity: 'error', file, line: i + 1 });
      }
    });
    if (!baseOf(src)) out.push({ sentence: `The feature item "${file}" has no library base; add one "@line-base ${m[2]}/<Name>" comment naming the library item it is based on.`, rule: 'LINE-BASE', severity: 'error', file, line: 1 });
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

  return {
    files: () => ({ ...files }),
    readLineProject,
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
    /** @returns {import('./contract.mjs').ApplyResult} */
    applyChange(_root, change) {
      const next = { ...files };
      for (const f of change.files) { if (f.content === null) delete next[f.path]; else next[f.path] = f.content; }
      const touched = new Set(change.files.map((f) => f.path));
      // Like the real writer (ops.mjs onlyNewProblems): only problems the change adds block it; old ones stay.
      const key = (x) => `${x.rule}|${x.file}|${x.sentence}`;
      const before = new Set(findingsOf(files).map(key));
      const findings = findingsOf(next).filter((x) => touched.has(x.file) && !before.has(key(x)));
      if (findings.some((x) => x.severity === 'error')) {
        return { ok: false, sentence: `Nothing was saved: ${findings[0].sentence.charAt(0).toLowerCase()}${findings[0].sentence.slice(1)}`, files: [], findings };
      }
      for (const k of Object.keys(files)) delete files[k];
      Object.assign(files, next);
      return { ok: true, sentence: `Saved. ${change.summary}`, files: [...touched], findings: [] };
    },
  };
}

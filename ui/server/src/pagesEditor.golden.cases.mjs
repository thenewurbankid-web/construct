// Golden-case corpus for the Pages Editor's deterministic JSX operations (#173).
//
// `runGoldenCases(mod)` drives every exported JSX analysis/edit operation of a pagesEditor-shaped
// module over a corpus of sources and returns a plain JSON-safe object. The committed
// `pagesEditor.golden.json` was captured from the ORIGINAL Babel implementation (before the
// typescript-estree migration); `pagesEditor.golden.test.mjs` re-runs the corpus against the current
// implementation and requires an identical result. Parser-specific error *detail* (the text after a
// known prefix such as "Snippet does not parse: ") legitimately differs between parsers, so
// `normalizeGolden` blanks only that suffix -- whether an operation errors, and everything else, must match.
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

export const SOURCES = {
  page: `import React from 'react';
import { Card } from '../components/Card.jsx';

export function Home({ title, count, ...rest }) {
  const [open, setOpen] = React.useState(false);
  const [n, setN] = useState(0);

  return (
    <div className="home" data-x='single' {...rest} hidden>
      <h1 id={title} tabIndex={0} aria-label={"lit"} className={\`t\${n}\`}>{title}</h1>
      <Card title={title} count={count} onClick={() => setOpen(!open)} open={open} />
      {open && <Card><p>Count: {count}</p></Card>}
      {[1, 2].map((i) => <li key={i}>{i}</li>)}
      <ul.Item a="1"><ns:tag x:y="z" /></ul.Item>
      <>
        <span>frag</span>
        <></>
      </>
    </div>
  );
}
`,
  entities: `export const A = () => (
  <div title="a &amp; b &quot;q&quot; &#39;x&#39; &lt;t&gt; &nbsp;end" alt='it&apos;s' data-multi="line1
line2">
    <b>café \u{1F600} </b><Emoji label="\u{1F600}" flag={false} /><i>中文</i>
  </div>
);
`,
  literals: `const X = () => (
  <A a={-1} b={1e3} c={0x10} d={1_000} e={null} f={/re/g} g={10n} h={true} i={"s"} j={'s'} k={\`t\`}
     l={(1)} m={("s")} n={a.b} o={fn()} p={<B />} q=<C /> r="x" s={undefined} t={this} u={a ? b : c} v={[1]} w={{ a: 1 }} x={(a + b)} y={( c )} z={a as any} aa={a!} bb={("p" + "q")} cc={0} dd={false} {...(a || b)} {...rest as any} />
);
`,
  ws: `export const W = () => (
  <div
    a = "1"
    b
    c ={ x }
    d='>'
  >
    <Tag
      e="1"
    ></Tag>
    <Self  f = {1}   />
  </div>
);
`,
  crlf: 'export function P() {\r\n\treturn (\r\n\t\t<div>\r\n\t\t\t<a href="x">y</a>\r\n\t\t\t<b />\r\n\t\t</div>\r\n\t);\r\n}\r\n',
  tsx: `import type { Props } from './types';
interface Local { a: string }
export default function Page({ a, b: renamed, c = 1 }: Local, extra) {
  const value = (raw as unknown) as string;
  const f = <T,>(x: T) => x;
  const [x, setX] = React?.useState<number>(0);
  const [y, setY] = useState<number>(0);
  const [z] = ns['useState'](1);
  class K { m(inner) { return <div>{inner}</div>; } }
  const o = { meth(objArg) { return 1; }, arrow: (arrowArg) => <p>{arrowArg}</p> };
  function nested(fnArg) { return <span>{fnArg}</span>; }
  return <section><Local2 a={a} v={value as any} /></section>;
}
declare function overload(a: string): void;
`,
  comments: `export const C = () => (
  <div>
    {/* a comment */}
    <p>{'>'} and {"<"}</p>
    {
      // line comment
    }
    <img src="x.png"
         alt="multi
line" />
  </div>
);
`,
  bareText: `export const T = () => (\n  <div title="x">\n    1 > 0 and } closes\n    <b a="1">a > b</b>\n    <i>}</i>\n  </div>\n);\n`,
  noJsx: `export const n = 1;\nexport function f(a) { return a; }\n`,
  invalid: `export const A = () => <div><span></div>;\n`,
  unclosed: `export const A = () => <div>\n`,
  emptyExpr: `export const A = () => <div a={} />;\n`,
  mismatch: `export const A = () => <div></span>;\n`,
};

export const SNIPPETS = {
  simple: '<div><Foo a="1" b={c} /></div>',
  padded: '\n\n   <div>\n     <A x="1" />\n     <B y={2} />\n     <C />\n   </div>\n\n',
  semi: '<div />;',
  fragment: '<><A a="1" /><B /></>',
  fragmentDeep: '<div>\n  <>\n    <A />\n  </>\n</div>',
  selfClosingRoot: '<Foo a="1" />',
  twoRoots: '<a /><b />',
  textOnly: 'hello',
  callOnly: 'foo()',
  empty: '',
  whitespace: '   \n ',
  unclosed: '<div>',
  badAttr: '<div a= />',
  nonJsxExpr: '1 + 1',
  siblings: '<ul>\n  <li a="1" b={x} {...s} />\n  <li c={3} />\n  <li />\n</ul>',
  siblingsInline: '<p><a x="1" /><b /><c y={2} /></p>',
  wireTarget: '<div>\n  <A msg="hi" n={1} flag />\n  <B />\n  <C msg="taken" />\n</div>',
};

// Replacement snippets thrown at patchNode (server-side validation of a user's edit).
export const REPLACEMENTS = {
  ok: '<div className="new">hi</div>',
  okPadded: '\n  <span>x</span>\n',
  okFragment: '<><b /></>',
  twoRoots: '<a /><b />',
  notJsx: '1 + 1',
  text: 'hello',
  broken: '<div>',
  empty: '',
  semi: '<div />;',
};

const CHILD_FILES = {
  'Named.tsx': 'export function Named({ title, count, onClick }) { return <b>{title}</b>; }\n',
  'Arrow.tsx': 'export const Arrow = ({ title: renamed, ...others }) => <i />;\n',
  'Local.tsx': 'const Local = ({ title }) => <i />;\nexport { Local };\n',
  'Def.tsx': 'export default function Def({ title, open }) { return <u />; }\n',
  'DefId.tsx': 'function Inner({ count }) { return null; }\nexport default Inner;\n',
  'DefArrow.tsx': 'export default ({ title }) => <s />;\n',
  'Typed.tsx': 'interface TypedProps { title: string; open?: boolean; onClick(): void; }\nexport function Typed(props: TypedProps) { return <b />; }\n',
  'Alias.tsx': 'type AliasProps = { title: string; count: number };\nexport const Alias = (props: AliasProps) => <b />;\n',
  'Open.tsx': 'interface OpenProps { [key: string]: unknown; title: string }\nexport function Open(props: OpenProps) { return <b />; }\n',
  'Rest.tsx': 'export function Rest(...args) { return null; }\n',
  'Defaulted.tsx': 'export function Defaulted({ title } = {}) { return null; }\n',
  'NoParam.tsx': 'export function NoParam() { return null; }\n',
  'Plain.tsx': 'export function Plain(props) { return null; }\n',
  'Member.tsx': 'export function Card({ title, count }) { return null; }\n',
  'Broken.tsx': 'export function Broken({ title } { return <<<;\n',
  'idx/index.tsx': 'export function Idx({ title, open }) { return null; }\n',
};

const CHILD_PAGE = `import { Named } from '../components/Named';
import { Arrow } from '../components/Arrow';
import { Local } from '../components/Local';
import Def from '../components/Def';
import DefId from '../components/DefId';
import DefArrow from '../components/DefArrow';
import { Typed } from '../components/Typed';
import { Alias } from '../components/Alias';
import { Open } from '../components/Open';
import { Rest } from '../components/Rest';
import { Defaulted } from '../components/Defaulted';
import { NoParam } from '../components/NoParam';
import { Plain } from '../components/Plain';
import * as Ui from '../components/Member';
import { Idx } from '../components/idx';
import { Broken } from '../components/Broken';
import { Missing } from '../components/Missing';
import { Pkg } from 'some-package';

export function Page({ title, count, open, onClick }) {
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Named title={title} /><Arrow /><Local /><Def /><DefId /><DefArrow /><Typed /><Alias /><Open /><Rest />
      <Defaulted /><NoParam /><Plain /><Ui.Card /><Idx /><Broken /><Missing /><Pkg /><Unimported /><div />
    </div>
  );
}
`;

function attempt(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { threw: true, name: e?.constructor?.name === 'PagesEditorError' ? 'PagesEditorError' : 'Error', status: e?.status ?? null, message: String(e?.message ?? e) };
  }
}

function projectTree(mod, source) {
  const { roots, byId } = mod.parsePageTree(source);
  const flat = [...byId.values()].map((n) => ({
    id: n.id, tag: n.tag, isFragment: n.isFragment, isCustomComponent: n.isCustomComponent,
    props: n.props, start: n.start, end: n.end, line: n.line, children: n.children.map((c) => c.id),
  }));
  return { roots: roots.map((r) => r.id), flat };
}

function idsOf(mod, source) {
  const { byId } = mod.parsePageTree(source);
  return [...byId.keys()];
}

function exerciseSource(mod, source) {
  const out = {};
  out.tree = attempt(() => projectTree(mod, source));
  out.serialized = attempt(() => mod.serializeTree(source));
  const idsRes = attempt(() => idsOf(mod, source));
  if (!idsRes.ok) return out;
  const ids = idsRes.value;
  out.nodes = {};
  const { byId } = mod.parsePageTree(source);
  for (const id of [...ids, 'n999']) {
    const node = byId.get(id);
    const n = {};
    n.snippet = attempt(() => mod.getNodeSnippet(source, id));
    n.props = attempt(() => mod.getNodeProps(source, id));
    n.unmapped = attempt(() => mod.findUnmappedProps(source, id));
    n.remove = attempt(() => mod.removeNodeInSnippet(source, id));
    n.up = attempt(() => mod.moveNodeInSnippet(source, id, 'up'));
    n.down = attempt(() => mod.moveNodeInSnippet(source, id, 'down'));
    n.sideways = attempt(() => mod.moveNodeInSnippet(source, id, 'left'));
    n.addChild = attempt(() => mod.addChildInSnippet(source, id));
    n.patchSame = attempt(() => mod.patchNode(source, id, source.slice(node?.start ?? 0, node?.end ?? 0), mod.hashOf(source)));
    n.patchStale = attempt(() => mod.patchNode(source, id, '<a />', 'deadbeef'));
    for (const [rname, repl] of Object.entries(REPLACEMENTS)) {
      n[`patch_${rname}`] = attempt(() => mod.patchNode(source, id, repl, mod.hashOf(source)));
    }
    n.attrNew = attempt(() => mod.buildAttributeSnippet(source, id, 'zzNew', 'string', 'v "q"'));
    n.attrNewKinds = ['boolean', 'number', 'identifier', 'expression'].map((k) => attempt(() => mod.buildAttributeSnippet(source, id, 'zzK', k, k === 'number' ? '7' : k === 'boolean' ? true : 'someVal')));
    n.attrBoolFalse = attempt(() => mod.buildAttributeSnippet(source, id, 'zzB', 'boolean', false));
    n.spreadBad = attempt(() => mod.buildAttributeSnippet(source, id, null, 'spread', 'x', 99));
    n.spreadNoIndex = attempt(() => mod.buildAttributeSnippet(source, id, null, 'spread', 'x'));
    const propsRes = n.props.ok ? n.props.value.props : [];
    n.attrEdits = {};
    for (const p of propsRes) {
      if (p.kind === 'spread') {
        n.attrEdits[`spread@${p.index}`] = attempt(() => mod.buildAttributeSnippet(source, id, null, 'spread', 'replaced', p.index));
        continue;
      }
      n.attrEdits[p.name] = {
        edit: ['string', 'number', 'boolean', 'identifier', 'expression'].map((k) => attempt(() => mod.buildAttributeSnippet(source, id, p.name, k, k === 'number' ? '3' : k === 'boolean' ? true : 'nv'))),
        remove: attempt(() => mod.removeAttributeSnippet(source, id, p.name)),
      };
    }
    n.removeMissing = attempt(() => mod.removeAttributeSnippet(source, id, 'noSuchAttr'));
    n.autoMap = attempt(() => mod.applyAutoMap(source, id, ['title', 'count']));
    out.nodes[id] = n;
    // rewire: every ordered sibling pair under this node, for every named prop of the source child.
    const rec = byId.get(id);
    if (rec) {
      out.nodes[id].rewire = [];
      for (const from of rec.children) for (const to of rec.children) {
        for (const p of from.props.filter((q) => q.kind !== 'spread')) {
          out.nodes[id].rewire.push({ from: from.id, to: to.id, prop: p.name, res: attempt(() => mod.rewireWireInSnippet(source, { parentId: id, propName: p.name, fromChildId: from.id, toChildId: to.id })) });
        }
      }
    }
  }
  return out;
}

function exerciseSnippet(mod, snippet) {
  const out = { tree: attempt(() => mod.parseSnippetToTree(snippet)) };
  out.exercise = exerciseSource(mod, snippet);
  return out;
}

function exerciseFs(mod) {
  const root = makeTempDir('construct-golden-');
  try {
    fs.writeFileSync(path.join(root, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nfeatures:\n  root: features\n');
    fs.mkdirSync(path.join(root, 'features/demo/pages'), { recursive: true });
    fs.mkdirSync(path.join(root, 'features/demo/components/idx'), { recursive: true });
    for (const [name, body] of Object.entries(CHILD_FILES)) {
      fs.mkdirSync(path.dirname(path.join(root, 'features/demo/components', name)), { recursive: true });
      fs.writeFileSync(path.join(root, 'features/demo/components', name), body);
    }
    fs.writeFileSync(path.join(root, 'features/demo/pages/Page.tsx'), CHILD_PAGE);
    const pageAbs = path.join(root, 'features/demo/pages/Page.tsx');
    const { byId, ast } = mod.parsePageTree(CHILD_PAGE);
    const out = {};
    for (const [id, node] of byId) {
      out[`unmapped:${id}:${node.tag}`] = attempt(() => mod.findUnmappedProps(CHILD_PAGE, id, root, pageAbs));
      out[`declared:${id}:${node.tag}`] = attempt(() => {
        const r = mod.resolveDeclaredPropNames(root, pageAbs, ast, node.tag.split('.')[0]);
        return r ? { closed: r.closed, names: [...r.names].sort() } : r;
      });
    }
    out.scopeNames = attempt(() => mod.collectComponentScopeNames(ast));
    return out;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export function runGoldenCases(mod) {
  const result = { sources: {}, snippets: {}, fs: exerciseFs(mod), scope: {} };
  for (const [name, source] of Object.entries(SOURCES)) {
    result.sources[name] = exerciseSource(mod, source);
    result.scope[name] = attempt(() => mod.collectComponentScopeNames(mod.parsePageTree(source).ast));
  }
  for (const [name, snippet] of Object.entries(SNIPPETS)) result.snippets[name] = exerciseSnippet(mod, snippet);
  return JSON.parse(JSON.stringify(result));
}

const PARSER_DETAIL_PREFIXES = [
  'Snippet does not parse: ',
  'Replacement snippet is not valid JSX: ',
  'Patched file would no longer parse: ',
  'Removing this node would leave invalid JSX: ',
  'Moving this node would leave invalid JSX: ',
  'Adding a child here would leave invalid JSX: ',
];

/** Blank ONLY the parser-specific detail of error text (and the message of raw parser errors);
 * every other byte of the result must match. */
export function normalizeGolden(value) {
  if (Array.isArray(value)) return value.map(normalizeGolden);
  if (value && typeof value === 'object') {
    if (value.threw && value.name === 'Error') return { ...value, message: '<parser error>' };
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'error' && typeof v === 'string' && Array.isArray(value.roots)) {
        out[k] = '<parser error>'; // parseSnippetToTree's raw parser message
      } else if (k === 'error' && typeof v === 'string') {
        const prefix = PARSER_DETAIL_PREFIXES.find((p) => v.startsWith(p));
        out[k] = prefix ? `${prefix}<detail>` : v;
      } else if (k === 'message' && typeof v === 'string') {
        const prefix = PARSER_DETAIL_PREFIXES.find((p) => v.startsWith(p));
        out[k] = prefix ? `${prefix}<detail>` : v;
      } else out[k] = normalizeGolden(v);
    }
    return out;
  }
  return value;
}

#!/usr/bin/env node
// Line primitives (roadmap item 1), the survey: reads the public type definitions of eight permissive UI libraries
// and writes survey.json, a list of descriptors only (component and part names, prop names, canonical states and
// events, cluster, licence). No library code is copied: the script reads .d.ts files through the TypeScript
// checker and shadcn/ui's public registry JSON (export names, data-slot names and which package an item wraps).
//
// The libraries are fetched read-only into a scratch folder OUTSIDE the repo first, e.g.:
//   npm install --ignore-scripts --legacy-peer-deps radix-ui@1.8.0 react-aria-components@1.22.1 @headlessui/react@2.2.10 \
//     @ark-ui/react@5.39.3 @mantine/core@9.7.2 @mantine/dates@9.7.2 @chakra-ui/react@3.37.0 @mui/material@9.5.0 @types/react@19
//   curl https://ui.shadcn.com/r/index.json, then https://ui.shadcn.com/r/styles/new-york-v4/<name>.json per registry:ui item
//
//   node packages/line-primitives/scripts/survey.mjs --libs <scratch>/node_modules --shadcn <scratch>/shadcn [--out survey.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { write } from '@line/construct-core/fs';
import { describeProps, STATE_IDS, EVENT_IDS } from '../vocabulary.mjs';
import { CLUSTERS, clusterOf } from '../clusters.mjs';
import { primitiveForCluster } from '../contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The surveyed sources. `heldOut` sources are kept out of the cluster descriptors and used only by the coverage metric. */
export const SOURCES = [
  { id: 'radix', package: 'radix-ui', docs: 'https://www.radix-ui.com/primitives/docs', heldOut: false },
  { id: 'react-aria', package: 'react-aria-components', docs: 'https://react-spectrum.adobe.com/react-aria/', heldOut: false },
  { id: 'headless-ui', package: '@headlessui/react', docs: 'https://headlessui.com/', heldOut: false },
  { id: 'ark', package: '@ark-ui/react', docs: 'https://ark-ui.com/', heldOut: false },
  { id: 'shadcn', package: 'shadcn/ui registry (new-york-v4)', docs: 'https://ui.shadcn.com/docs/components', heldOut: false },
  { id: 'mui', package: '@mui/material', docs: 'https://mui.com/material-ui/', heldOut: false },
  { id: 'chakra', package: '@chakra-ui/react', docs: 'https://chakra-ui.com/docs/components', heldOut: true },
  { id: 'mantine', package: '@mantine/core', extra: ['@mantine/dates'], docs: 'https://mantine.dev/', heldOut: true },
];

/** The first word after a family name that makes an export a part of that family (DialogTitle, TableRow). */
const PART_WORDS = new Set(('Root Trigger Content Title Description Close Overlay Portal Item Items Indicator Label Thumb Track Range Header '
  + 'Footer Body Panel Panels List Icon Separator Viewport Value Arrow Anchor Control Input Text Image Fallback Action Actions Cancel '
  + 'Button Buttons Positioner Backdrop Section Cell Row Column Head Caption Container Option Options Dropdown Target Chevron Provider '
  + 'Context Template Link Page Ellipsis Previous Prev Next Step Completed Media Placeholder Hidden Marker Empty Search Clear Popup Popover '
  + 'Sub Checkbox Radio Heading Error Helper Addon Element Day Month Year Week Grid Cells Details Summary Bar Graphic Floating Pin Tag '
  + 'Tags Swatch Area Preview Toggle Avatar Badge Expand Collapse Group Divider Wrapper Track Mark Thumbs Selection Loading Spinner Tbody Td Th Tr Thead Tfoot Scroll Tab Dots First Last Main Aside Navbar Stack').split(' '));
/** Props that are styling or plumbing on every library, never a state or an event. */
const NOISE_PROPS = new Set(['className', 'style', 'children', 'sx', 'classes', 'component', 'asChild', 'as', 'ref', 'key', 'css', 'slotProps',
  'slots', 'unstyled', 'vars', 'styles', 'mod', 'recipe', 'unstyled', 'dir', 'id', 'render', 'theme', 'components', 'componentsProps']);
/** Declaration files whose props are DOM, CSS or style-system props rather than the component's own. */
const NOISE_FILE = /node_modules\/(@types\/react|csstype|@emotion|@mui\/system|@mui\/types|@mui\/styled-engine)\/|styled-system|style-props|\/Box\/|\/core\/factory\/|\/polymorphic|\/styles\/|BoxProps|types\/jsx\.d\.ts/;

const arg = (name, def) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; };

/**
 * The words of a PascalCase name.
 * @param {string} s A name.
 * @returns {string[]} Its capitalised words.
 */
function words(s) { return s.match(/[A-Z][a-z0-9]*/g) ?? []; }

/**
 * Read one package's licence (SPDX id from package.json, first copyright line from its LICENSE file).
 * @param {string} dir The package folder.
 * @returns {{spdx: string, copyright: string|null, version: string}} The licence.
 */
function licenceOf(dir) {
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const file = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
  const text = file ? fs.readFileSync(path.join(dir, file), 'utf8') : '';
  // A real notice ("Copyright (c) 2022 WorkOS", "Copyright 2019 Adobe"), not the Apache text's own "copyright notice ...".
  const copyright = text.split('\n').map((l) => l.trim()).find((l) => /^copyright\s+(\(c\)|©|\d{4})/i.test(l)) ?? (pj.author ? `${typeof pj.author === 'string' ? pj.author : pj.author.name} (package.json author)` : null);
  return { spdx: pj.license, copyright, version: pj.version };
}

/**
 * The components exported by a package's type entry, as raw families: a namespace export is a family whose members
 * are its parts; flat exports are grouped afterwards by name.
 * @param {string} pkgDir The package folder.
 * @returns {{families: Map<string, {parts: Map<string, string[]>, namespace: boolean}>}} Families by name, each part with its own prop names.
 */
function readTypes(pkgDir) {
  const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const dot = pj.exports?.['.'];
  const typesEntry = pj.types ?? pj.typings ?? dot?.types ?? dot?.import?.types ?? dot?.default?.types;
  const entry = path.resolve(pkgDir, typesEntry);
  const program = ts.createProgram([entry], {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true, noEmit: true, types: [], strict: false,
  });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(entry);
  const mod = checker.getSymbolAtLocation(sf);
  const resolve = (s) => ((s.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(s) : s);

  /** Prop names of a component symbol, or null when it is not a component. */
  const propsOf = (sym) => {
    if (!(sym.flags & ts.SymbolFlags.Value) && !(sym.flags & ts.SymbolFlags.Alias)) return null;
    const decl = sym.valueDeclaration ?? sym.declarations?.[0];
    if (!decl) return null;
    let type;
    try { type = checker.getTypeOfSymbolAtLocation(sym, decl); } catch { return null; }
    const sigs = [...type.getCallSignatures(), ...type.getConstructSignatures()];
    if (!sigs.length) return null;
    const ret = checker.typeToString(sigs[0].getReturnType());
    if (!/Element|ReactNode|ReactPortal|JSX|Component|null/.test(ret)) return null;
    const param = sigs[0].getParameters()[0];
    if (!param) return [];
    const ptype = checker.getTypeOfSymbolAtLocation(param, decl);
    const pieces = ptype.isUnion() ? ptype.types : [ptype];
    const names = new Set();
    for (const t of pieces) {
      for (const prop of checker.getPropertiesOfType(checker.getApparentType(t))) {
        const n = prop.getName();
        if (NOISE_PROPS.has(n) || n.startsWith('aria-') || n.startsWith('data-') || n.startsWith('__')) continue;
        const decls = prop.getDeclarations() ?? [];
        if (decls.length && decls.every((d) => NOISE_FILE.test(d.getSourceFile().fileName.replace(/\\/g, '/')))) continue;
        names.add(n);
      }
    }
    return [...names].sort();
  };

  /** @type {Map<string, {parts: Map<string, string[]>, namespace: boolean}>} */
  const families = new Map();
  const flat = new Map();
  for (const exp of checker.getExportsOfModule(mod)) {
    const name = exp.getName();
    if (!/^[A-Z]/.test(name) || /(Context|Provider|Props|Theme|Classes)$/.test(name) || name.includes('_')) continue;
    const sym = resolve(exp);
    if (sym.flags & (ts.SymbolFlags.ValueModule | ts.SymbolFlags.NamespaceModule) && !(sym.flags & ts.SymbolFlags.Function)) {
      const parts = new Map();
      const seen = new Set();
      for (const m of checker.getExportsOfModule(sym)) {
        const mn = m.getName();
        if (!/^[A-Z]/.test(mn) || /(Context|Props)$/.test(mn)) continue;
        const ms = resolve(m);
        if (seen.has(ms)) continue;
        const props = propsOf(ms);
        if (!props) continue;
        seen.add(ms);
        parts.set(mn, props);
      }
      // A namespace that only merges types into a component (Mantine's `namespace Accordion`) falls through to it.
      if (parts.size) { families.set(name, { parts, namespace: true }); continue; }
    }
    const props = propsOf(sym);
    if (props) flat.set(name, props);
  }
  // Flat exports: an export is a part of the shortest other export it extends by a part word, unless its own name is
  // a known cluster (IconButton is a component, not a part of Icon); duplicates of namespace members are dropped.
  const nsNames = [...families.keys()];
  const names = [...flat.keys()].sort((a, b) => a.length - b.length);
  const familyOf = new Map();
  for (const n of names) {
    if (nsNames.some((f) => n !== f && n.startsWith(f) && /^[A-Z]/.test(n.slice(f.length)))) continue; // DialogRoot next to Dialog.*
    if (families.has(n)) continue;
    const owner = clusterOf(n) ? null : names.find((f) => f !== n && f.length < n.length && n.startsWith(f) && familyOf.get(f) === f && PART_WORDS.has(words(n.slice(f.length))[0]));
    familyOf.set(n, owner ?? n);
  }
  for (const [n, fam] of familyOf) {
    if (!families.has(fam)) families.set(fam, { parts: new Map(), namespace: false });
    families.get(fam).parts.set(n, flat.get(n));
  }
  return { families };
}

/**
 * shadcn/ui registry items as families: the item's exports are its parts; props pass through to the package it wraps,
 * so a Radix-backed item takes the Radix family's props.
 * @param {string} dir Folder holding index.json and items/<name>.json.
 * @param {Map<string, {parts: Map<string, string[]>}>} radix Radix families (for wrapped items).
 * @returns {Map<string, {parts: Map<string, string[]>, namespace: boolean, wraps: string|null}>} Families by PascalCase item name.
 */
function readShadcn(dir, radix) {
  const out = new Map();
  const NATIVE = { input: ['disabled', 'readOnly', 'required', 'value', 'onChange', 'onFocus', 'onBlur'], textarea: ['disabled', 'readOnly', 'required', 'value', 'onChange', 'onFocus', 'onBlur'], button: ['disabled', 'onClick'], select: ['disabled', 'required', 'value', 'onChange'], a: ['onClick'] };
  for (const f of fs.readdirSync(path.join(dir, 'items')).sort()) {
    const item = JSON.parse(fs.readFileSync(path.join(dir, 'items', f), 'utf8'));
    if (item.type !== 'registry:ui') continue;
    const src = (item.files ?? []).map((x) => x.content ?? '').join('\n');
    const pascal = item.name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
    const exported = new Set();
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) for (const n of m[1].split(',')) { const t = n.trim().split(/\s+as\s+/).pop(); if (/^[A-Z]/.test(t)) exported.add(t); }
    for (const m of src.matchAll(/export\s+(?:default\s+)?function\s+([A-Z]\w*)/g)) exported.add(m[1]);
    const radixPart = src.match(/from\s+["']radix-ui["']/) ? [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s+["']radix-ui["']/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0])).filter(Boolean) : [];
    const radixPkg = [...src.matchAll(/from\s+["']@radix-ui\/react-([a-z-]+)["']/g)].map((m) => m[1].split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(''));
    const wrapsRadix = [...radixPart, ...radixPkg].find((n) => radix.has(n) && n !== 'Slot') ?? null;
    const other = src.match(/from\s+["']((?!react|radix-ui|@radix-ui|@\/|lucide|class-variance|clsx|tailwind)[@a-z][\w@/.-]*)["']/)?.[1] ?? null;
    const nativeEl = src.match(/React\.ComponentProps<\s*["'](\w+)["']\s*>/)?.[1] ?? null;
    const own = [...src.matchAll(/\b(variant|size|orientation|decorative|inset|side|align|showCloseButton)\??\s*[:=,]/g)].map((m) => m[1]);
    const parts = new Map();
    for (const n of [...exported].sort()) {
      let props = [...own];
      if (wrapsRadix) {
        const fam = radix.get(wrapsRadix);
        const suffix = n.startsWith(pascal) ? n.slice(pascal.length) || 'Root' : n;
        const match = fam.parts.get(suffix) ?? (n === pascal ? fam.parts.get('Root') : null);
        props = [...props, ...(match ?? [])];
      } else if (nativeEl && NATIVE[nativeEl] && n === pascal) {
        props = [...props, ...NATIVE[nativeEl]];
      }
      parts.set(n, [...new Set(props)].sort());
    }
    if (!parts.size) parts.set(pascal, own);
    out.set(pascal, { parts, namespace: false, wraps: wrapsRadix ? `radix-ui ${wrapsRadix}` : other ?? (nativeEl ? `<${nativeEl}>` : null) });
  }
  return out;
}

/**
 * Turn a library's families into component descriptors.
 * @param {string} lib Source id.
 * @param {Map<string, {parts: Map<string, string[]>, namespace: boolean, wraps?: string|null}>} families Its families.
 * @returns {object[]} One descriptor per top-level component.
 */
function describe(lib, families) {
  const out = [];
  for (const [name, fam] of [...families].sort((a, b) => a[0].localeCompare(b[0]))) {
    const cluster = clusterOf(name);
    const props = [...new Set([...fam.parts.values()].flat())].sort();
    const d = describeProps(props, cluster?.id);
    out.push({
      lib, name, cluster: cluster?.id ?? null, role: cluster?.role ?? null,
      parts: [...fam.parts.keys()].filter((p) => p !== name).sort(),
      states: d.states, events: d.events, passThroughEvents: d.ignored,
      props: props.filter((x) => !/^on[A-Z]/.test(x)),
      ...(fam.wraps !== undefined ? { wraps: fam.wraps } : {}),
    });
  }
  return out;
}

/**
 * Build the whole survey.
 * @param {string} libs node_modules folder holding the npm sources.
 * @param {string} shadcn Folder holding the shadcn registry JSON.
 * @returns {object} The survey document.
 */
export function buildSurvey(libs, shadcn) {
  const sources = [];
  const components = [];
  let radixFamilies = null;
  for (const s of SOURCES) {
    let families;
    let licence;
    if (s.id === 'shadcn') {
      const lic = fs.existsSync(path.join(shadcn, 'LICENSE.md')) ? fs.readFileSync(path.join(shadcn, 'LICENSE.md'), 'utf8') : '';
      licence = { spdx: 'MIT', copyright: lic.split('\n').find((l) => /^copyright/i.test(l.trim()))?.trim() ?? 'Copyright (c) 2023 shadcn', version: 'registry new-york-v4 (fetched 2026-10-12)' };
      families = readShadcn(shadcn, radixFamilies);
    } else {
      licence = licenceOf(path.join(libs, s.package));
      families = readTypes(path.join(libs, s.package)).families;
      for (const extra of s.extra ?? []) for (const [k, v] of readTypes(path.join(libs, extra)).families) if (!families.has(k)) families.set(k, v);
      if (s.id === 'radix') radixFamilies = families;
    }
    const described = describe(s.id, families);
    components.push(...described);
    sources.push({ ...s, licence, components: described.length, permissive: ['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', 'BSD-2-Clause'].includes(licence.spdx) });
  }
  const training = new Set(SOURCES.filter((s) => !s.heldOut).map((s) => s.id));
  const clusters = CLUSTERS.map((c) => {
    const members = components.filter((x) => x.cluster === c.id);
    const train = members.filter((x) => training.has(x.lib));
    const byLib = {};
    for (const m of members) (byLib[m.lib] ??= []).push(m.name);
    return {
      id: c.id, role: c.role, apg: c.apg, what: c.what,
      frequency: new Set(train.map((m) => m.lib)).size,
      heldOutFrequency: new Set(members.filter((m) => !training.has(m.lib)).map((m) => m.lib)).size,
      members: byLib,
      states: [...new Set(train.flatMap((m) => m.states))].sort(),
      events: [...new Set(train.flatMap((m) => m.events))].sort(),
      parts: [...new Set(train.flatMap((m) => m.parts.map((p) => p.replace(new RegExp(`^${m.name}`), ''))))].sort(),
      primitive: primitiveForCluster(c.id)?.name ?? null,
    };
  }).sort((a, b) => b.frequency - a.frequency || a.id.localeCompare(b.id));
  return {
    about: 'Line primitives survey (roadmap item 1): descriptors only, read from each library\'s public type definitions (shadcn/ui: its public registry JSON). No library code is copied. Regenerate with packages/line-primitives/scripts/survey.mjs.',
    generated: new Date().toISOString().slice(0, 10),
    vocabulary: { states: STATE_IDS, events: EVENT_IDS },
    method: {
      components: 'Every exported value whose type is callable and returns a React element. A namespace export (Radix, Ark, Chakra) is one component whose members are its parts; a flat export that extends another export by a part word (DialogTitle, TableRow) is a part of it, unless its own name is a cluster (IconButton).',
      props: 'The component\'s own props across all its parts: DOM attributes, aria-*, data-*, CSS and style-system props are dropped by declaration file.',
      states: 'Prop names mapped to canonical states by vocabulary.mjs (disabled, isDisabled -> disabled; error, isInvalid -> invalid; ...).',
      events: 'on* props mapped to canonical events by vocabulary.mjs; DOM pass-through, pointer, hover and animation callbacks are kept apart as passThroughEvents.',
      clusters: 'Each top-level component falls into the first clusters.mjs pattern its name matches. Cluster states, events, parts and frequency use the training sources only; held-out sources (chakra, mantine) are used by the coverage metric.',
    },
    sources,
    clusters,
    components,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const libs = arg('--libs');
  const shadcn = arg('--shadcn');
  if (!libs || !shadcn) { console.error('Usage: survey.mjs --libs <node_modules> --shadcn <dir> [--out survey.json]'); process.exit(2); }
  const out = path.resolve(arg('--out', path.join(HERE, '..', 'survey.json')));
  const survey = buildSurvey(path.resolve(libs), path.resolve(shadcn));
  write(out, `${JSON.stringify(survey, null, 1)}\n`);
  const unclustered = survey.components.filter((c) => !c.cluster).length;
  console.log(`Wrote ${out}: ${survey.components.length} components from ${survey.sources.length} sources, ${survey.clusters.filter((c) => c.frequency).length} clusters, ${unclustered} unclustered.`);
}

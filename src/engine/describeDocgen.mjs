// The react-docgen adapter behind `describeComponent` (#434). This is the ONLY file that imports react-docgen
// (MIT); replace it (or hand `describeComponent` another `describe(source, filename)`) and nothing else changes.
//
// Contract, our own and small: `describeSource(source, filename) -> DescribeResult`, never throws, JSON only.
//   { ok: true,  components: [{ name, description, props: [{ name, type, required, default, description }] }] }
//   { ok: true,  components: [] }                      -- parsed fine, no component found ("no docs")
//   { ok: false, code: 'PARSE_ERROR' | 'ENGINE_ERROR', error }
// It only PARSES the text it is given. It never imports, requires or evaluates the file (react-docgen reads a
// Babel AST), so describing a component can never run project code.
import { parse, builtinResolvers } from 'react-docgen';

const MAX_TYPE_DEPTH = 6;
const MAX_TEXT = 400;

const clip = (s) => (typeof s === 'string' && s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);

/** A react-docgen type node (TS, Flow or PropTypes) as one short line of text. */
export function typeText(t, depth = 0) {
  if (!t || typeof t !== 'object') return '';
  if (depth > MAX_TYPE_DEPTH) return typeof t.name === 'string' ? t.name : '';
  if (typeof t.raw === 'string' && t.raw) return clip(t.raw);
  const list = (items, sep) => (Array.isArray(items) ? items.map((x) => typeText(x, depth + 1)).filter(Boolean).join(sep) : '');
  switch (t.name) {
    case 'union':
      return clip(list(t.elements, ' | ') || 'union');
    case 'intersection':
      return clip(list(t.elements, ' & ') || 'intersection');
    case 'Array':
      return clip(`Array<${list(t.elements, ', ')}>`);
    case 'literal':
      return clip(String(t.value ?? 'literal'));
    case 'enum':
      return clip(Array.isArray(t.value) ? t.value.map((v) => v?.value ?? '').filter(Boolean).join(' | ') || 'enum' : 'enum');
    case 'arrayOf':
      return clip(`${typeText(t.value, depth + 1)}[]`);
    case 'instanceOf':
      return clip(String(t.value ?? 'instanceOf'));
    default:
      if (Array.isArray(t.elements) && t.elements.length) return clip(`${t.name}<${list(t.elements, ', ')}>`);
      return clip(typeof t.name === 'string' ? t.name : '');
  }
}

function propOf(name, p) {
  const type = typeText(p.tsType ?? p.flowType ?? p.type);
  const dv = p.defaultValue && typeof p.defaultValue.value === 'string' ? clip(p.defaultValue.value) : null;
  return { name, type: type || 'unknown', required: p.required === true, default: dv, description: clip(typeof p.description === 'string' ? p.description : '') };
}

const isNoComponent = (e) => /no suitable component definition/i.test(String(e?.message)) || /MISSING_DEFINITION/i.test(String(e?.code));

/** Parse `source` (the text of `filename`) and describe every exported component in it. Never throws. */
export function describeSource(source, filename) {
  let docs;
  try {
    docs = parse(source, {
      filename,
      resolver: new builtinResolvers.FindExportedDefinitionsResolver(),
      babelOptions: { babelrc: false, configFile: false },
    });
  } catch (e) {
    if (isNoComponent(e)) return { ok: true, components: [] };
    if (e instanceof SyntaxError || /SyntaxError|Unexpected token|Unterminated|Missing semicolon/i.test(String(e?.name) + String(e?.message).slice(0, 200))) {
      return { ok: false, code: 'PARSE_ERROR', error: 'This file could not be parsed (syntax error), so no props are shown.' };
    }
    return { ok: false, code: 'ENGINE_ERROR', error: 'The documentation reader could not read this file.' };
  }
  const list = Array.isArray(docs) ? docs : [docs];
  const components = list
    .filter((d) => d && typeof d === 'object')
    .map((d, i) => ({
      name: typeof d.displayName === 'string' && d.displayName ? d.displayName : `Component ${i + 1}`,
      description: clip(typeof d.description === 'string' ? d.description : ''),
      props: Object.entries(d.props ?? {}).map(([name, p]) => propOf(name, p ?? {})),
    }));
  return { ok: true, components };
}

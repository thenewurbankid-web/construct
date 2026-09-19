// Unit kinds that describe Construct's own vocabulary: rule, envelope, generator.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES } from '../../../config.mjs';
import { createContext, fileEntry, healthFrom } from '../facts.mjs';
import { refOf } from './feature.mjs';

const LEVEL = { brief: 0, standard: 1, full: 2 };
export const CONSTRUCT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const nextItem = (kind, id, why) => ({ ref: refOf(kind, id), why, cli: `construct summarize ${refOf(kind, id)}` });

// ---- rule ------------------------------------------------------------------------------------
export const ruleKind = {
  kind: 'rule',
  description: 'An enforced rule (e.g. PAGE-006): what it says, configured severity, current violations and exceptions here.',
  list: () => Object.keys(DEFAULT_RULES).sort().map((id) => ({ id, name: DEFAULT_RULES[id].name })),
  resolve: (ctx, ref) => (/^[A-Z]+-\d{3}$/.test(ref) && DEFAULT_RULES[ref] ? [{ kind: 'rule', id: ref, tier: 1 }] : []),
  summarize: (ctx, id, detail) => {
    const d = LEVEL[detail];
    const def = DEFAULT_RULES[id];
    if (!def) return null;
    const cfg = ctx.config();
    const configured = cfg.rules?.[id];
    const v = ctx.violations().filter((x) => x.rule === id);
    const exceptions = (cfg.exceptions || []).filter((e) => (e.rule ? [e.rule] : e.rules || []).includes(id)).map((e) => ({ path: e.path, ...(e.reason ? { reason: e.reason } : {}), ...(e.expires ? { expires: String(e.expires instanceof Date ? e.expires.toISOString().slice(0, 10) : e.expires) } : {}) }));
    const items = v.map((x) => ({ file: x.file, line: x.line, message: x.message, severity: x.severity }));
    const first = v[0];
    return {
      name: id, path: undefined,
      summary: `Rule ${id}: ${def.name}. Default severity ${def.severity}${configured?.severity && configured.severity !== def.severity ? `, configured ${configured.severity}` : ''}; ${v.length} violation(s) in this project.`,
      sections: {
        rule: { id, statement: def.name, defaultSeverity: def.severity, configuredSeverity: configured?.severity ?? def.severity, ...(first?.module ? { enforcedBy: first.module } : {}) },
        violations: d === 0 ? { count: v.length, files: [...new Set(v.map((x) => x.file))].slice(0, 5) } : d === 1 ? { count: v.length, items: items.slice(0, 10) } : { count: v.length, items, why: first?.why, suggestedFix: first?.suggestedFix },
        exceptions,
      },
      health: healthFrom(v.length ? [{ severity: configured?.severity === 'warning' || def.severity === 'warning' ? 'warning' : 'error', code: id, message: `${v.length} violation(s).` }] : []),
      links: { parent: 'project:.', children: [...new Set(v.map((x) => x.file))].slice(0, 10).map((f) => refOf('file', f)) },
      next: [...new Set(v.map((x) => x.file))].slice(0, 3).map((f) => nextItem('file', f, `A file violating ${id}`)),
    };
  },
};

// ---- envelope --------------------------------------------------------------------------------
const envelopeSchemaPath = path.join(CONSTRUCT_ROOT, 'schemas', 'envelope.v1.json');
export const envelopeKind = {
  kind: 'envelope',
  description: 'The Context Envelope contract (schemas/envelope.v1.json) handed between pipeline steps.',
  list: () => [{ id: 'v1', name: 'Context Envelope v1', path: 'schemas/envelope.v1.json' }],
  resolve: (ctx, ref) => (['envelope', 'v1', 'envelope.v1'].includes(ref) ? [{ kind: 'envelope', id: 'v1', tier: 1 }] : []),
  summarize: (ctx, id, detail) => {
    const d = LEVEL[detail];
    if (id !== 'v1') return null;
    const schema = JSON.parse(fs.readFileSync(envelopeSchemaPath, 'utf8'));
    const first = (s) => String(s || '').split(/(?<=[.!?])\s/)[0].slice(0, d >= 2 ? 400 : 140);
    const fields = Object.entries(schema.properties || {}).map(([k, v]) => ({ name: k, required: (schema.required || []).includes(k), type: v.type || (v.const !== undefined ? `const ${v.const}` : 'any'), ...(d >= 1 ? { description: first(v.description) } : {}), ...(v.enum ? { enum: v.enum } : {}) }));
    return {
      name: 'Context Envelope v1', path: 'schemas/envelope.v1.json',
      summary: `Context Envelope v1: the JSON state handed between construct pipeline steps (${fields.map((f) => f.name).join(', ')}). ${first(schema.description)}`,
      sections: { schema: 'schemas/envelope.v1.json', version: 1, fields, producers: ['src/engine/envelope.mjs (createEnvelope, validateEnvelope)', 'src/engine/pipeline.mjs (runPipeline)'], cli: 'construct pipeline run < envelope.json' },
      health: healthFrom([]),
      links: { children: [refOf('generator', 'pipeline')] }, next: [nextItem('generator', 'pipeline', 'The pipeline that consumes envelopes')],
    };
  },
};

// ---- generator -------------------------------------------------------------------------------
const GENERATORS = {
  workflow: { file: 'src/engine/workflowGenerator.mjs', cli: 'construct create workflow <name> --feature <f>', what: 'Generates an XState workflow from a state descriptor, no LLM.' },
  controller: { file: 'src/engine/controllerBinder.mjs', cli: 'construct create controller <name> --feature <f>', what: 'Binds a page\'s props to a hook\'s members and writes the controller.' },
  page: { file: 'src/engine/pageTransformer.mjs', cli: 'construct import <name> --feature <f> --layers page --from <path>', what: 'Ingests an existing page into a presentation-only page.' },
  service: { file: 'src/service-generator.mjs', cli: 'construct create service <name> --feature <f>', what: 'Generates a service/API layer (optionally from an OpenAPI spec).' },
  layer: { file: 'src/generators.mjs', cli: 'construct create <layer> <name> --feature <f>', what: 'Scaffolds one layer file (or a whole vertical) from templates.' },
  pipeline: { file: 'src/engine/pipeline.mjs', cli: 'construct pipeline run', what: 'Runs generator steps in one validated, atomic transaction over a Context Envelope.' },
};
export const generatorKind = {
  kind: 'generator',
  description: 'A deterministic generator block (workflow, controller, page, service, layer, pipeline): what it makes, CLI, API.',
  list: () => Object.entries(GENERATORS).map(([id, g]) => ({ id, name: id, path: g.file })),
  resolve: (ctx, ref) => (GENERATORS[ref] ? [{ kind: 'generator', id: ref, tier: 3 }] : []),
  summarize: (ctx, id, detail) => {
    const d = LEVEL[detail];
    const g = GENERATORS[id];
    if (!g) return null;
    const f = createContext(CONSTRUCT_ROOT).facts(g.file);
    return {
      name: id, path: g.file,
      summary: `Generator "${id}": ${g.what} CLI: ${g.cli}.`,
      sections: { generator: { id, what: g.what, cli: g.cli, deterministic: true, llm: 'never (LLM fill is a separate opt-in --llm step)' }, module: fileEntry(f, { withExports: d >= 1 }), ...(d >= 1 ? { exports: f.exports } : {}) },
      health: healthFrom([]),
      links: { children: [refOf('envelope', 'v1')] }, next: [nextItem('envelope', 'v1', 'The envelope generators hand each other')],
    };
  },
};

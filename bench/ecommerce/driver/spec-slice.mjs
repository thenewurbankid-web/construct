// #889 -- the spec slice: a local Line-arm builder gets the app overview and a feature index in its system prompt, and
// the current feature's acceptance points in plan answers, instead of all of SPEC.md up front. #908: the plan service
// measures open work against this spec (openWork.mjs) and its card carries the points on every answer.
//
//   readSpec(file?)                 SPEC.md -> {overview, features: [{name, story, points: [{id, text}]}]}
//   overviewWithIndex(spec)         the overview plus one line per feature (its story and its point ids)
//   currentFeature(spec, work)      the feature the plan works on now: the first with open work (#908), else the first
//   sliceText(feature)              "Current feature: <name> ..." with its numbered acceptance points
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPEC_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'SPEC.md');

/**
 * @param {string} [file]
 * @returns {{overview: string, features: {name: string, story: string, points: {id: string, text: string}[]}[]}}
 */
export function readSpec(file = SPEC_FILE) {
  const text = fs.readFileSync(file, 'utf8');
  const at = text.search(/^## /m);
  const overview = (at < 0 ? text : text.slice(0, at)).trim();
  const features = [];
  for (const sec of (at < 0 ? '' : text.slice(at)).split(/^(?=## )/m)) {
    const head = /^## (.+)$/m.exec(sec)?.[1] ?? '';
    const name = /\(feature `([\w-]+)`\)/.exec(head)?.[1];
    if (!name) continue;
    const story = head.replace(/\s*\(feature `[\w-]+`\)\s*$/, '').trim();
    const points = [...sec.matchAll(/^\d+\.\s+([A-Z]+-\d+):\s+(.+)$/gm)].map((m) => ({ id: m[1], text: m[2].trim() }));
    features.push({ name, story, points });
  }
  return { overview, features };
}

/** The overview plus a feature index (story and point ids); the points themselves come with plan status. */
export function overviewWithIndex(spec) {
  const index = spec.features.map((f) => `- \`${f.name}\`: ${f.story} (${f.points[0]?.id ?? ''}..${f.points.at(-1)?.id ?? ''}, ${f.points.length} points)`);
  return [spec.overview, '', '## The features, in build order', '', ...index, '',
    'Plan status shows the acceptance points of the feature you are working on (`status <feature>` shows another\'s).',
    'Copy a feature\'s story and points from there into `line.createFeature`.'].join('\n');
}

/**
 * The feature the plan works on now (#908): the first feature with open work in spec order (the plan service's
 * view().work.current, packages/engine/line/openWork.mjs), else the spec's first. Not the last feature touched.
 * @param {ReturnType<typeof readSpec>} spec @param {{current: string|null} | null | undefined} work
 */
export function currentFeature(spec, work) {
  return spec.features.find((f) => f.name === work?.current) ?? spec.features[0] ?? null;
}

/** The slice as the builder reads it. */
export function sliceText(f) {
  if (!f) return '';
  return [`Current feature: ${f.name} (${f.story})`, ...f.points.map((p, i) => `${i + 1}. ${p.id}: ${p.text}`)].join('\n');
}

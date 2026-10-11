// cd1: part of the Features chat (static rules over the read routes' answers, no model). Tested by FeatureChat.spec.mjs.
import type { ChatMessage, LineFeatureDetail } from '../types';
import { fixable } from './FixActions.ts';

/** The first message of the side panel, for the open feature. */
export function itemIntro(feature: string): ChatMessage {
  return { id: 'intro', from: 'line', text: `${feature} is open beside this chat. Ask what is missing, for an explanation, or add something from the library.` };
}

/** "What is missing?" for the open feature: its problems and the spec points not covered yet. */
export function itemMissing(detail: LineFeatureDetail, id: string): ChatMessage {
  const points = (detail.spec?.stories ?? []).flatMap((s) => s.points).filter((p) => !p.covered);
  const lines = [...detail.findings.map((f) => f.sentence), ...points.map((p) => `Not covered yet: ${p.text.replace(/\.?$/, '.')}`)];
  if (!detail.spec) lines.push(`${detail.name} has no spec yet, so nothing says what it must do.`);
  if (!lines.length) return { id, from: 'line', text: `Nothing is missing in ${detail.name}: every item passes the checks and every spec point is covered.` };
  const fix = detail.findings.some(fixable) ? ' Pick Fix what is wrong to apply a suggested fix.' : '';
  return { id, from: 'line', text: `${lines.join(' ')}${fix}`, details: detail.findings.map((f) => `${f.rule} ${f.file}:${f.line}`) };
}

/** "Explain" for the open feature: the static summary. */
export function itemExplain(detail: LineFeatureDetail, id: string): ChatMessage {
  const files = Object.values(detail.items).flat().map((i) => i.file);
  return { id, from: 'line', text: detail.summary.sentences.join(' '), details: files };
}

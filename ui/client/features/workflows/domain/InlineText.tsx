import type { InlineSegment, NarrativeView, WorkflowNarrative } from '../types';

// Pure (DOMAIN-001) — the narrator's sentences carry two tiny inline
// markers: *state name* and `code name`. parseInline splits a sentence into
// typed segments so a component can render <em>/<code> without any HTML
// injection (the text is never interpreted as markup).
export function parseInline(text: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  const re = /\*([^*]+)\*|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: 'text', value: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { kind: 'state', value: m[1] } : { kind: 'code', value: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

/** The server's narrative with every sentence pre-split into inline segments. */
export function toNarrativeView(n: WorkflowNarrative): NarrativeView {
  return {
    machines: n.machines.map((m) => ({
      ...m,
      summarySegments: parseInline(m.summary),
      states: m.states.map((s) => ({ ...s, sentenceSegments: s.sentences.map(parseInline) })),
      scenarios: m.scenarios.map((sc) => ({ ...sc, lineSegments: sc.text.map(parseInline) })),
      findings: m.findings.map((f) => ({ ...f, messageSegments: parseInline(f.message) })),
    })),
  };
}

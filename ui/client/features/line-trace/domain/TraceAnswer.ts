// Pure (DOMAIN-001): any server answer to POST /api/line/trace as a TraceAnswer.
import type { TraceAnswer, TraceMatch } from '../types.ts';

export function toTraceAnswer(body: unknown): TraceAnswer {
  const b = (body && typeof body === 'object' ? body : {}) as {
    ok?: unknown;
    tools?: unknown;
    sentence?: unknown;
  };
  if (b.ok === true && Array.isArray(b.tools)) return { ok: true, match: body as TraceMatch };
  return {
    ok: false,
    sentence: typeof b.sentence === 'string' && b.sentence ? b.sentence : 'Trace could not read that request.',
  };
}

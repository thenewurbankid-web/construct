import { lineHttp } from '@/lib/lineHttp';
import { toTraceAnswer } from '../domain/TraceAnswer';
import type { LineTraceApi } from '../types';

// Trace's use of the shared LINE_API mirror (lib/lineHttp.ts): POST /api/line/trace, a pure read.
export const lineTraceApi: LineTraceApi = {
  trace: async (req) => {
    try {
      return toTraceAnswer(await lineHttp.trace(req));
    } catch {
      return {
        ok: false,
        sentence: 'The Cockpit server did not answer, so Trace cannot light anything up right now.',
      };
    }
  },
};

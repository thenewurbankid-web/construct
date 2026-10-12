import type { LineTraceApi } from '@/features/line-trace';
import { readOpenProjectRequest } from '../domain/OpenProjectRequest';
import { traceMatchFor } from '../domain/OpenProjectScript';

/** The Trace bar's matcher on the Your projects screen. With no project open there is no project to ask the server
 * about (POST /api/line/trace reads the open project), so the request is read statically here, against the same
 * registered controls and the same TraceMatch shape. Nothing is sent anywhere. */
export function openProjectTraceApi(projects: string[]): LineTraceApi {
  return {
    trace: async (req) => {
      const request = (req.request ?? '').trim();
      const match = traceMatchFor(request, readOpenProjectRequest(request, projects));
      if (!match) return { ok: false, sentence: 'Type what you want to do: start a new project, bring one in from GitHub, or open one.' };
      return { ok: true, match };
    },
  };
}

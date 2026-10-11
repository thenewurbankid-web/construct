// The contract's own mock (plain ESM with JSDoc types, outside this app), used as is.
import { createMockLineOps } from '../../../../../packages/engine/line/mock.mjs';
import type { LineFeatureDetail, LineFeaturesApi, LineProject, LineRefusal } from '../types';

type MockOps = { readLineProject: (root: string) => LineProject; readLineFeature: (root: string, name: string) => LineFeatureDetail };

// One in-memory project per browser tab; a LineOpError becomes the same {ok: false, sentence, code} the server sends.
const ops = createMockLineOps() as unknown as MockOps;
const ROOT = '/mock';

export const mockLineFeaturesApi: LineFeaturesApi = {
  getProject: async () => ops.readLineProject(ROOT),
  getFeature: async (name): Promise<LineFeatureDetail | LineRefusal> => {
    try {
      return ops.readLineFeature(ROOT, name);
    } catch (e) {
      const err = e as { name?: string; sentence?: string; code?: string };
      if (err.name === 'LineOpError' && err.sentence) return { ok: false, sentence: err.sentence, code: err.code ?? 'REFUSED' };
      throw e;
    }
  },
};

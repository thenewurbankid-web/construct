import { getJson, postJson } from '@/lib/http';
import type { LineHttp } from './lineContract';

// The client's one mirror of LINE_API (packages/engine/line/contract.mjs), served by ui/server's lineApi.mjs,
// lineOpsApi.mjs and lineRenderApi.mjs under /api/line. A refusal arrives as 400 {ok: false, sentence, code};
// getJson/postJson read the body whatever the status, so a refusal reaches the screen as its sentence. Every write
// goes through these routes (Construct's writer on the server), never anywhere else.
export const lineHttp: LineHttp = {
  getProject: () => getJson('/api/line/project'),
  getPageTree: (file) => getJson(`/api/line/page-tree?file=${encodeURIComponent(file)}`),
  setPageProp: (req) => postJson('/api/line/page-prop', req),
  baseOn: (req) => postJson('/api/line/base-on', req),
  promote: (req) => postJson('/api/line/promote', req),
  render: (file, props) => {
    const q = new URLSearchParams({ file });
    if (props !== undefined) q.set('props', props);
    return getJson(`/api/line/render?${q.toString()}`);
  },
  getFeature: (name) => getJson(`/api/line/feature?name=${encodeURIComponent(name)}`),
  getWorkspace: () => getJson('/api/line/workspace'),
  setWorkspace: (req) => postJson('/api/line/workspace', req),
  fix: (req) => postJson('/api/line/fix', req),
  getFragments: (file) => getJson(`/api/line/fragments?file=${encodeURIComponent(file)}`),
  setFragment: (req) => postJson('/api/line/fragment', req),
  newProject: (req) => postJson('/api/line/new-project', req),
};

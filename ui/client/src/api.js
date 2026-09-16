// Thin fetch wrappers over the backend's REST endpoints (see
// ui/server/src/index.mjs). Every command endpoint returns
// { ok, output: string[], attribution: {tool, llm} | null, error? } —
// callers render `output` and `attribution` distinctly rather than
// collapsing everything into a generic success/failure toast.

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return data;
}

export const api = {
  getSettings: () => fetch('/api/settings').then((r) => r.json()),
  updateSettings: (body) => postJson('/api/settings', body),
  // Runs `init` (architecture.yml + AGENTS.md + a `core` feature) against
  // the currently selected project directory. Response includes the same
  // { resolvedProjectRoot, valid, needsInit } shape as getSettings/
  // updateSettings, so callers can refresh project status from it directly.
  init: () => postJson('/api/init', {}),
  create: (body) => postJson('/api/create', body),
  refactor: (body) => postJson('/api/refactor', body),
  research: (body) => postJson('/api/research', body),
  importAction: (body) => postJson('/api/import', body),
  // The CLI's real usage/help text (see src/usage.mjs + src/repl.mjs on the
  // backend) — used by the Help page so its CLI reference can't drift from
  // what `construct` and `construct repl`'s `help` actually print.
  getHelp: () => fetch('/api/help').then((r) => r.json()),

  // Pages editor (epic #48 — pages browser, JSX tree, snippet/props
  // save-back, auto-map). Every one of these is scoped server-side to
  // features/<feature>/pages/ (see ui/server/src/pagesEditor.mjs) — the
  // client never needs to enforce that itself, only render what comes back.
  getFeatures: () => fetch('/api/pages/features').then((r) => r.json()),
  getPages: (feature) => fetch(`/api/pages?feature=${encodeURIComponent(feature)}`).then((r) => r.json()),
  getPageTree: (feature, file) =>
    fetch(`/api/pages/tree?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}`).then((r) => r.json()),
  getNodeSnippet: (feature, file, nodeId) =>
    fetch(`/api/pages/node?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}&nodeId=${encodeURIComponent(nodeId)}`).then((r) => r.json()),
  saveNodeSnippet: (body) => postJson('/api/pages/node', body),
  getNodeProps: (feature, file, nodeId) =>
    fetch(`/api/pages/props?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}&nodeId=${encodeURIComponent(nodeId)}`).then((r) => r.json()),
  saveNodeProp: (body) => postJson('/api/pages/props', body),
  getUnmappedProps: (feature, file, nodeId) =>
    fetch(`/api/pages/unmapped?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}&nodeId=${encodeURIComponent(nodeId)}`).then((r) => r.json()),
  applyAutoMap: (body) => postJson('/api/pages/automap', body),
};

/** WebSocket URL for the import route wizard, relative to wherever the
 * frontend is served from (works through the Vite dev proxy in dev, and
 * through whatever reverse proxy fronts the built app in production). */
export function wizardSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/wizard`;
}

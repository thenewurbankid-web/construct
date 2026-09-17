// Shared, non-feature helper — every feature's service/ layer imports this
// instead of hand-rolling its own base-URL logic (avoids DRY-001 near-
// duplicates across dashboard/settings/wizard/help/pages-editor's services).
// Lives outside features/ on purpose: it is plumbing, not a feature, and
// Construct's own SOC/SLICE rules only govern files under `features/`.
//
// ui/server (Express) stays a separate process from this Next.js app (see
// the decision on epic #64) and already runs with `cors()` enabled for
// every origin, so both REST and the wizard's WebSocket connect to it
// directly rather than through a Next.js rewrite proxy — see the comment in
// next.config.ts for why the WebSocket case rules that proxy out.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

export const WS_BASE = process.env.NEXT_PUBLIC_WS_BASE || 'ws://localhost:4000';

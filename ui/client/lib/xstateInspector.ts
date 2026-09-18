// Epic #57 / #58 — opt-in, dev-only XState inspector wiring.
//
// PRIVACY: @statelyai/inspect's own default target is the HOSTED inspector
// at https://stately.ai/inspect, which would send every actor's context and
// events to a third party. This helper therefore has NO default URL: the
// inspector is enabled only when BOTH hold —
//   1. NODE_ENV === 'development', and
//   2. NEXT_PUBLIC_XSTATE_INSPECT_URL is explicitly set (e.g. a locally
//      run Stately Sketch at http://127.0.0.1:3000/inspect, or a
//      self-hosted inspector).
// Otherwise it returns undefined and the library is never even imported, so
// there is zero network activity. Setting the URL to https://stately.ai/inspect
// is possible but is then an explicit, visible choice by the developer.
//
// Usage:  const inspect = await startXStateInspector();
//         createActor(machine, { inspect }).start();   // undefined => no-op

export type InspectorConfig = { enabled: false; reason: string } | { enabled: true; url: string };

export function resolveInspectorConfig(env: { NODE_ENV?: string; NEXT_PUBLIC_XSTATE_INSPECT_URL?: string }): InspectorConfig {
  if (env.NODE_ENV !== 'development') return { enabled: false, reason: 'inspector is dev-only (NODE_ENV is not "development")' };
  const url = env.NEXT_PUBLIC_XSTATE_INSPECT_URL?.trim();
  if (!url) return { enabled: false, reason: 'NEXT_PUBLIC_XSTATE_INSPECT_URL is not set (opt-in; no default)' };
  return { enabled: true, url };
}

/** Starts the inspector if (and only if) it is explicitly enabled; resolves
 * to the `inspect` callback for `createActor`, or undefined when off. */
export async function startXStateInspector() {
  const config = resolveInspectorConfig({
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_XSTATE_INSPECT_URL: process.env.NEXT_PUBLIC_XSTATE_INSPECT_URL,
  });
  if (!config.enabled) return undefined;
  const { createBrowserInspector } = await import('@statelyai/inspect');
  return createBrowserInspector({ url: config.url }).inspect;
}

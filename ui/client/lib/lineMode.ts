// Line mock mode (shared by every Line screen; lib/lineMockOps.ts is the one in-memory project): the Pages screen runs on the contract's mock (packages/engine/line/mock.mjs) instead of the
// server while the real /api/line routes are being built. On with NEXT_PUBLIC_LINE_MOCK=1 at build time, or for
// one browser tab by opening any Cockpit URL with ?line=mock (kept for the tab's session; ?line=real turns it off).
const KEY = 'cockpit.line-mock';

export function isLineMock(): boolean {
  if (process.env.NEXT_PUBLIC_LINE_MOCK === '1') return true;
  if (typeof window === 'undefined') return false;
  const asked = new URLSearchParams(window.location.search).get('line');
  try {
    if (asked === 'mock') window.sessionStorage.setItem(KEY, '1');
    if (asked === 'real') window.sessionStorage.removeItem(KEY);
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return asked === 'mock';
  }
}

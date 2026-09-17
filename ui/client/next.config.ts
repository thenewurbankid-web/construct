import path from 'node:path';
import type { NextConfig } from 'next';

// ui/server (Express + ws) stays a fully separate process, called from this
// Next.js app exactly like it was called from the Vite app before (see the
// decision recorded on epic #64: Next.js API routes don't handle long-lived
// WebSocket connections well, so the wizard's transport stays on Express).
//
// Decision (documented on #70): rather than a Next.js rewrite proxy for
// `/api/*` (which reliably forwards plain HTTP but not a WebSocket upgrade
// without a custom server — reintroducing exactly the coupling #64 decided
// to avoid), every request — REST and the wizard's WebSocket alike — goes
// straight to ui/server's own origin (see lib/apiBase.ts), which already
// runs with `cors()` enabled for every origin. One mechanism for both kinds
// of call, instead of a proxy for one and a direct connection for the
// other. No rewrite/proxy config is needed here as a result.
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;

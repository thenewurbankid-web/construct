# Construct

Read architecture.yml before changing code.

Default flow: Route → Controller → Workflow → Service → API; Controller → Page → Component.

Pages: no business logic, workflows, services, API calls, or fetch.
Components: presentation/local UI state only.
Features: isolated; cross-feature access goes through index.ts.
Domain: pure by default. Services: external effects.

Run `construct validate` before finishing changes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

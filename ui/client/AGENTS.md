# Construct

Read architecture.yml before changing code.

Default flow: Route → Controller → Workflow → Service → API; Controller → Page → Component.

Pages: no business logic, workflows, services, API calls, or fetch.
Components: presentation/local UI state only.
Features: isolated; cross-feature access goes through index.ts.
Domain: pure by default. Services: external effects.

Run `construct validate` before finishing changes.

# Construct

**Opinionated architecture for AI-native Next.js applications.**

Construct makes architectural conventions executable. It ships strict defaults and lets each project modify policy through `architecture.yml`.

## Install

```bash
npm install
npm link
```

Or publish the package and install it globally/project-local with npm.

## Initialize a project

```bash
construct init my-app
cd my-app
npm install
construct sync
construct validate
```

Construct does not replace Next.js, TypeScript, ESLint, dependency-cruiser, XState, Stately, or Playwright. It orchestrates architecture policy around them.

## Default architecture

```text
Route → Controller → Workflow → Service → API
             └────→ Page → Component

Workflow → Domain
Service  → Domain
Hook     → Workflow / Service / Domain
```

## Non-negotiable defaults

- Routes are thin and delegate.
- Controllers compose; they do not become business-logic dumping grounds.
- Workflows own application state and flow.
- Hooks own React/application logic only when React context is needed.
- Domain is pure by default.
- Services own network/external effects.
- Pages are presentation-only.
- Components are presentation-only except local UI state.
- Features are isolated behind `index.ts` public APIs.
- One primary module per file.
- Every responsibility has an architectural owner.

## Modifying conventions

Change `architecture.yml`:

```yaml
rules:
  PAGE-004: warning
  PURE-001: off
```

Severity:

- `error` — validation fails
- `warning` — reported but does not fail
- `off` — disabled

Temporary exceptions may be scoped and expired:

```yaml
exceptions:
  - id: LEGACY-001
    path: features/legacy/**
    rules: [PAGE-004]
    reason: Temporary migration
    owner: platform-team
    expires: 2026-12-31
```

## Commands

```bash
construct init [dir]
construct feature create <name>
construct generate <layer> <name> --feature <feature>
construct sync
construct validate
construct validate --format json
construct doctor
```

## AI-agent workflow

Agents should read `architecture.yml`, make the smallest local change, and run validation. JSON diagnostics expose rule ID, severity, file, line, message, rationale, expected boundary, and suggested fix.

## Architecture source of truth

`architecture.yml` is policy. Construct's implementation provides generators, validation, CLI orchestration, diagnostics, and integration configuration. This is deliberately opinionated but modifiable.

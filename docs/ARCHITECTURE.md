# Construct Architecture Specification

## Philosophy

Construct is intentionally **opinionated out of the box but modifiable by policy**. A convention is valuable when a team can understand it, enforce it, and deliberately change it.

## Feature ownership

A feature owns behavior, state, UI, services, domain rules, types and its public API. Internal files are private. Cross-feature consumers use `index.ts`.

## Layer contracts

### Route
Navigation entry point. Delegates to a controller. No business logic or effects.

### Controller
Application composition boundary. Connects application behavior to presentation.

### Workflow
Application flow and state. XState is the default implementation; Stately is the visual modeling/editor layer.

### Hook
React-aware business/application logic when React context is genuinely required.

### Domain
Pure feature-specific business rules. No network, storage, DOM, or hidden effects.

### Service
External I/O, API calls, SDKs and side effects.

### Page
Props to JSX. No business logic, workflow, service, API, fetch, or domain imports.

### Component
Reusable presentation. Local UI state is allowed; application/business dependencies are not.

## Enforcement

Construct combines project policy with static validation and dependency boundaries. The goal is not to create a second compiler; it is to make architectural intent executable and useful to AI agents.

## Shared building blocks

Construct's own implementation reuses small deterministic packages rather than re-implementing them: see `docs/capabilities.md` for the maintained inventory, and `src/ast/README.md` for the AST package (parse, walk, extract, generate) used by both the CLI and `ui/server`.

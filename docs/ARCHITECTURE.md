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

## Frozen, externally-authored presentation

A design tool (Subframe, Figma-to-code, a shared design system) may own some markup. Declare it under `frozen:` in `architecture.yml` (globs relative to the project root, allowed to reach outside it). The supported pattern is **controller wraps frozen component**: the controller imports the externally-authored component and forwards props; hooks/workflows/domain own data and state. Construct never writes into frozen paths, and `PAGE-007` / `COMPONENT-004` / `CONTROLLER-002` (default `warning`) flag pages, components and controllers that re-author markup already present in a frozen source instead of importing it. Projects without `frozen:` are unaffected. See the README section "Wrapping frozen, externally-authored UI".

## Enforcement

Construct combines project policy with static validation and dependency boundaries. The goal is not to create a second compiler; it is to make architectural intent executable and useful to AI agents.

## Shared building blocks

Construct's own implementation reuses small deterministic packages rather than re-implementing them: see `docs/capabilities.md` for the maintained inventory, and `packages/ast/README.md` for the AST package (parse, walk, extract, generate) used by both the CLI and `ui/server`.

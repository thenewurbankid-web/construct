# Construct — MVP Roadmap: Phases 1–3

## Phase 1 — Foundation

### Goals
- Stabilize the package
- Establish a production CLI
- Add configuration loading
- Establish test infrastructure
- Create architecture fixture projects

### Deliverables
- Production TypeScript build
- `construct` executable
- Project/config discovery
- Consistent CLI exit codes
- Unit tests
- Valid and invalid architecture fixtures
- Cross-platform filesystem handling
- Package metadata and versioning

### Acceptance criteria
```text
npm run build       ✓
npm test            ✓
npm run lint        ✓
construct doctor    ✓
```

---

## Phase 2 — Enforcement

### Goal
Turn Construct's architectural conventions into executable policy.

### Deliverables
- TypeScript AST-based rule engine
- Complete default rule set
- Layer dependency enforcement
- Feature isolation enforcement
- Public API enforcement
- Forbidden API/import enforcement
- Domain purity checks
- React boundary checks
- Exception system
- Rule severity: `error`, `warning`, `off`
- Human-readable diagnostics
- JSON diagnostics

### Default architecture
```text
Route
  ↓
Controller
  ↓
Workflow → Service → API
  ↓
Page
  ↓
Component
```

### Acceptance criteria
Construct must reliably reject:

```text
Page → Service
Page → Workflow
Page → fetch()
Page → Domain

Component → Service
Component → Workflow
Component → Controller
Component → Domain

Workflow → React/UI
Service → React/UI
Domain → fetch()

Feature A → Feature B internal file
```

and permit the approved architecture.

---

## Phase 3 — Framework

### Goal
Make Construct usable on a real Next.js application.

### Project bootstrap
```bash
npx create-construct-app my-app
```

Creates a working Next.js App Router project with TypeScript, ESLint, Construct, XState, tests, `architecture.yml`, `AGENTS.md`, `features/`, `shared/`, and CI configuration.

### Feature generator
```bash
construct feature create checkout
```

Creates:

```text
features/checkout/
├── controllers/
├── workflows/
├── hooks/
├── domain/
├── services/
├── pages/
├── components/
├── types.ts
└── index.ts
```

### Layer generators
```bash
construct controller create Checkout --feature checkout
construct workflow create Checkout --feature checkout
construct hook create Checkout --feature checkout
construct domain create calculateTotal --feature checkout
construct service create Checkout --feature checkout
construct page create Checkout --feature checkout
construct component create CheckoutForm --feature checkout
```

### Generator contract
Every generated artifact must:
1. Follow the default architecture.
2. Use the correct layer.
3. Update the feature public API where appropriate.
4. Compile.
5. Pass Construct validation.
6. Follow naming conventions.

### Acceptance criteria
A fresh project must pass:

```bash
npm install
npm run build
npm test
construct validate
```

A generated feature must pass validation immediately after creation. A deliberately invalid change must fail with a rule ID, file, line, explanation, and suggested fix.

---

## Definition of Phase 3 Complete

A developer can bootstrap a real Next.js project, generate a complete feature and its layers, and validate it with Construct without manually configuring architectural boundaries.

```text
✓ Architecture valid
✓ Feature boundaries valid
✓ Dependencies valid
✓ Layer rules valid
✓ Generated code valid
```

## Deliberately Deferred

- Cockpit visual architecture editor
- Architecture graph UI
- Visual rule editor
- Cloud architecture registry
- Team collaboration
- Automatic AI refactoring
- Enterprise controls
- Hosted Construct platform
- Marketplace/plugin ecosystem

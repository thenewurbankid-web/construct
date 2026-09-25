# The placement filter (#641, part of epic #616)

A requirement card (`docs/REQUIREMENT-CARD.md`, #640) says what the person wants: nouns, verbs, named checks. Placement says
where each verb's code belongs, by three fixed questions and two data tables, with no model: it is the step between the
card and the chooser plan (`docs/BLOCK-CONTRACT.md`, #617).

- Code: `packages/core/placement.mjs` (`@line/construct-core/placement`).
- `placeCard(card, { layers, framework, screen, answers })` gives `{ blocks, open, offers, notes, decisions, errors }` (`offers` are closed questions that never hold the plan back: the list shape, below);
  `resolvePlacementOpen(card, answers, options)` answers an open question; `planFromBlocks(blocks, { feature, root })` gives
  `{ ok, plan, decisions, files, errors }`; `checkPlacementImports(blocks, layers)` proves the layer assignment obeys the
  import rules; `blockSummary(result)` and `blockLines(result)` are what a person, an LLM and a decision model read.

## The three questions

Asked of every verb, in this order (`PLACEMENT_QUESTIONS`). The first yes decides, except that a write which also needs the
browser gets both a client leaf and a mutation.

| # | Question | Yes | Rules that answer it (`ANSWER_RULES`) |
|---|---|---|---|
| 1 | Does it need a browser API (state, an effect, an event handler)? | **client leaf** | an `interact` verb; an interactive UI part (`button`, `form`, `input`, `menu`, `keyboard`) among the verb's nouns |
| 2 | Does it touch a secret or a database? | **server** | an `external` noun; a `write` on an `entity`; a `read` of an `entity` while the card has a session state ("logged-in"); a read or write of an `entity` while the card carries `auth-session-check`, `server-only-secret` or `owner-only-access` |
| 3 | Does it change data on the backend? | **mutation**; no: **server read** | a `write` verb |

A no to questions 1 and 2 is a **presentational** block: it is shown from props. So a plain read of an entity with no
session, secret or outside service is presentational: the data arrives as props, and to make it a server read say so in the
sentence ("a logged-in user", or name the service).

## Layers

`LAYER_TABLE` maps each result to the project's layers. Every layer of a row imports only what `config.layers[...].canImport`
allows (`checkPlacementImports` proves it; a page never imports a service). The route entry (`app/**/page.tsx`) is not a step of a
plain plan (the notes say to wire it by hand); a shaped screen's plan wires it (see "The route entry, sync and the dependency").

| Placement | Layers (Next.js App Router, framework `nextjs`) | Layers (no Server Components, framework `react-spa`) |
|---|---|---|
| server read | domain (the data shape), service (owns the fetch), controller (the Server Component: awaits the fetch, renders the page) | the same, plus a hook that runs the fetch in the browser, and the controller wires the hook |
| presentational | component, page (from props) | the same |
| client leaf | hook (state, effect, handler), controller (wires the hook to the page; a `"use client"` leaf) | the same |
| mutation | service (owns the write: the Server Action body), workflow (the states of the write) | the same (a call to a write endpoint of your own API) |

A server read also gets a presentational companion (`b1-view`) that shows it, and a controller always has its page
(`LAYER_PREREQUISITES`). A project whose config has no server components or actions (`react-spa`) uses this table's own
layers, and the result says so in `notes`. Names come from the card: a data object gives `SubscriptionPlan` (modifiers such as
"current" dropped), an action is the verb plus its object (`ManageBillingDetails`), the screen is the first data object.

## Worked example: subscription billing

The sentence is the owner's; `test/placement.test.mjs` runs the code below and compares its results with the JSON, so this
page cannot go stale. The card is the one in `docs/REQUIREMENT-CARD.md`: state `logged-in user`, entities `current
subscription plan` and `billing details`, ui-part `button`, external `Stripe`, verbs `see` (read), `click` (interact),
`manage` (write), and "safely" as `auth-session-check`, `server-only-secret` and `validated-redirect`.

<!-- placement-example:code -->
```js
import { parseRequirement } from '@line/construct-core/requirement-card';
import { placeCard, planFromBlocks } from '@line/construct-core/placement';

const { card } = parseRequirement(
  'A logged-in user needs to see their current subscription plan and be able to click a button to manage their billing details safely via Stripe.',
);

export const placement = placeCard(card); // framework defaults to 'nextjs' (App Router)
export const { plan, files } = planFromBlocks(placement.blocks, { feature: 'billing', root: '/path/to/project' });
```

`placement`: "see" is a server read (question 1 no, 2 yes because the data sits behind a session, 3 no) with a presentational
companion; "click" is a client leaf; "manage" is a mutation (Stripe is a secret, it writes). "safely" attaches to the server
blocks:

<!-- placement-example:placement -->
```json
{
  "version": "placement.v1",
  "ok": true,
  "complete": true,
  "framework": "nextjs",
  "variant": "app-router",
  "blocks": [
    {
      "id": "b1",
      "verbs": [
        "v1"
      ],
      "nouns": [
        "n1",
        "n2"
      ],
      "label": "see current subscription plan",
      "placement": "server-read",
      "answers": {
        "browserApi": false,
        "touchesSecretOrDb": true,
        "changesBackend": false
      },
      "layers": [
        {
          "layer": "domain",
          "name": "SubscriptionPlan",
          "why": "The shape of the data the Server Component fetches."
        },
        {
          "layer": "service",
          "name": "SubscriptionPlan",
          "why": "Owns the server-side fetch; the secret stays here.",
          "uses": [
            "domain"
          ]
        },
        {
          "layer": "controller",
          "name": "SubscriptionPlan",
          "why": "The Server Component: awaits the fetch and renders the page.",
          "uses": [
            "service",
            "domain"
          ]
        }
      ],
      "checks": [
        "c1",
        "c2"
      ],
      "checkNames": [
        "auth-session-check",
        "server-only-secret"
      ],
      "why": "Server read: fetched on the server, changes nothing. Because data behind a signed-in session lives in a database; a server-side check guards this data."
    },
    {
      "id": "b1-view",
      "verbs": [
        "v1"
      ],
      "nouns": [
        "n1",
        "n2"
      ],
      "label": "see current subscription plan",
      "placement": "presentational",
      "answers": {
        "browserApi": false,
        "touchesSecretOrDb": false,
        "changesBackend": false
      },
      "layers": [
        {
          "layer": "component",
          "name": "SubscriptionPlan",
          "why": "Shows the data from props; no data access."
        },
        {
          "layer": "page",
          "name": "SubscriptionPlan",
          "why": "Composes the components from props; imports no service.",
          "uses": [
            "component"
          ]
        }
      ],
      "checks": [],
      "checkNames": [],
      "why": "Presentational: shown from props. Because it shows what the server read returns."
    },
    {
      "id": "b2",
      "verbs": [
        "v2"
      ],
      "nouns": [
        "n3"
      ],
      "label": "click button",
      "placement": "client-leaf",
      "answers": {
        "browserApi": true,
        "touchesSecretOrDb": false,
        "changesBackend": false
      },
      "layers": [
        {
          "layer": "hook",
          "name": "ClickButton",
          "why": "Holds the state, effect or event handler of a \"use client\" leaf."
        },
        {
          "layer": "controller",
          "name": "SubscriptionPlan",
          "why": "Wires the \"use client\" leaf to the page; no logic of its own.",
          "uses": [
            "hook"
          ]
        }
      ],
      "checks": [],
      "checkNames": [],
      "why": "Client leaf: needs the browser. Because the person acts on the screen, which is an event handler in the browser; it works through an interactive part of the screen."
    },
    {
      "id": "b3",
      "verbs": [
        "v3"
      ],
      "nouns": [
        "n4",
        "n5"
      ],
      "label": "manage billing details Stripe",
      "placement": "mutation",
      "answers": {
        "browserApi": false,
        "touchesSecretOrDb": true,
        "changesBackend": true
      },
      "layers": [
        {
          "layer": "service",
          "name": "ManageBillingDetails",
          "why": "Owns the write: the Server Action body; the secret stays here."
        },
        {
          "layer": "workflow",
          "name": "ManageBillingDetails",
          "why": "The states of the Server Action call (idle, pending, done, failed).",
          "uses": [
            "service"
          ]
        }
      ],
      "checks": [
        "c1",
        "c2",
        "c3"
      ],
      "checkNames": [
        "auth-session-check",
        "server-only-secret",
        "validated-redirect"
      ],
      "why": "Mutation: changes backend data on the server. Because an outside service needs a secret that must stay on the server; a stored data object is written to a database; a server-side check guards this data; a write verb changes stored data."
    }
  ],
  "open": [],
  "offers": [],
  "notes": [
    "App Router: a client leaf is a \"use client\" leaf, a server read a Server Component fetch, a mutation a Server Action. The generators do not write the \"use client\" and \"use server\" directives yet: add them by hand.",
    "The route entry (app/**/page.tsx) is not created by a plan step: it imports the controller (by hand or with `construct import --route`)."
  ],
  "decisions": [],
  "errors": []
}
```

`plan` (an ordinary plan: `validatePlan` accepts it, `touches` is derived by `block-flows.mjs`, the controller depends on
everything it wires):

<!-- placement-example:plan -->
```json
{
  "version": 1,
  "ticket": {
    "source": "text",
    "title": "Place blocks for billing"
  },
  "steps": [
    {
      "id": "s1",
      "title": "Create feature billing",
      "flow": "create.feature",
      "args": {
        "name": "billing"
      },
      "executor": "deterministic",
      "touches": {
        "features": [
          "billing"
        ],
        "files": [
          {
            "path": "features/billing/types.ts",
            "change": "create"
          },
          {
            "path": "features/billing/index.ts",
            "change": "create"
          }
        ]
      },
      "rationale": "The slice every unit below goes into."
    },
    {
      "id": "s2",
      "title": "Create domain SubscriptionPlan",
      "flow": "create.unit",
      "args": {
        "layer": "domain",
        "name": "SubscriptionPlan",
        "feature": "billing"
      },
      "executor": "deterministic",
      "dependsOn": [
        "s1"
      ],
      "touches": {
        "features": [
          "billing"
        ],
        "files": [
          {
            "path": "features/billing/domain/SubscriptionPlan.tsx",
            "change": "create",
            "layer": "domain"
          }
        ]
      },
      "rationale": "The shape of the data the Server Component fetches."
    },
    {
      "id": "s3",
      "title": "Create service SubscriptionPlan",
      "flow": "create.unit",
      "args": {
        "layer": "service",
        "name": "SubscriptionPlan",
        "feature": "billing"
      },
      "executor": "deterministic",
      "dependsOn": [
        "s1",
        "s2"
      ],
      "touches": {
        "features": [
          "billing"
        ],
        "files": [
          {
            "path": "features/billing/services/SubscriptionPlan.tsx",
            "change": "create",
            "layer": "service"
          }
        ]
      },
      "rationale": "Owns the server-side fetch; the secret stays here."
    },
    {
      "id": "s4",
      "title": "Create service ManageBillingDetails",
      "flow": "create.unit",
      "args": {
        "layer": "service",
        "name": "ManageBillingDetails",
        "feature": "billing"
      },
      "executor": "deterministic",
      "dependsOn": [
        "s1"
      ],
      "touches": {
        "features": [
          "billing"
        ],
        "files": [
          {
            "path": "features/billing/services/ManageBillingDetails.tsx",
            "change": "create",
            "layer": "service"
          }
        ]
      },
      "rationale": "Owns the write: the Server Action body; the secret stays here."
    },
    {
      "id": "s5",
      "title": "Create workflow ManageBillingDetails",
      "flow": "create.unit",
      "args": {
        "layer": "workflow",
        "name": "ManageBillingDetails",
        "feature": "billing"
      },
      "executor": "deterministic",
      "dependsOn": [
        "s1",
        "s4"
      ],
      "touches": {
        "features": [
          "billing"
        ],
        "files": [
          {
            "path": "features/billing/workflows/ManageBillingDetails.tsx",
            "change": "create",
            "layer": "workflow"
          }
        ]
      },
      "rationale": "The states of the Server Action call (idle, pending, done, failed)."
    },
    {
      "id": "s6",
      "title": "Create hook ClickButton",
      "flow": "create.unit",
      "args": {
        "layer": "hook",
        "name": "ClickButton",
        "feature": "billing"
      },
      "executor": "deterministic",
      "dependsOn": [
        "s1",
        "s5"
      ],
      "touches": {
        "features": [
          "billing"
        ],
        "files": [
          {
            "path": "features/billing/hooks/useClickButton.tsx",
            "change": "create",
            "layer": "hook"
          }
        ]
      },
      "rationale": "Holds the state, effect or event handler of a \"use client\" leaf."
    },
    {
      "id": "s7",
      "title": "Create component SubscriptionPlan",
      "flow": "create.unit",
      "args": {
        "layer": "component",
        "name": "SubscriptionPlan",
        "feature": "billing"
      },
      "executor": "deterministic",
      "dependsOn": [
        "s1"
      ],
      "touches": {
        "features": [
          "billing"
        ],
        "files": [
          {
            "path": "features/billing/components/SubscriptionPlan.tsx",
            "change": "create",
            "layer": "component"
          }
        ]
      },
      "rationale": "Shows the data from props; no data access."
    },
    {
      "id": "s8",
      "title": "Create page SubscriptionPlan",
      "flow": "create.unit",
      "args": {
        "layer": "page",
        "name": "SubscriptionPlan",
        "feature": "billing"
      },
      "executor": "deterministic",
      "dependsOn": [
        "s1",
        "s7"
      ],
      "touches": {
        "features": [
          "billing"
        ],
        "files": [
          {
            "path": "features/billing/pages/SubscriptionPlanPage.tsx",
            "change": "create",
            "layer": "page"
          }
        ]
      },
      "rationale": "Composes the components from props; imports no service."
    },
    {
      "id": "s9",
      "title": "Create controller SubscriptionPlan",
      "flow": "create.unit",
      "args": {
        "layer": "controller",
        "name": "SubscriptionPlan",
        "feature": "billing"
      },
      "executor": "deterministic",
      "dependsOn": [
        "s1",
        "s2",
        "s3",
        "s6",
        "s8"
      ],
      "touches": {
        "features": [
          "billing"
        ],
        "files": [
          {
            "path": "features/billing/controllers/SubscriptionPlanController.tsx",
            "change": "create",
            "layer": "controller"
          }
        ]
      },
      "rationale": "The Server Component: awaits the fetch and renders the page."
    }
  ]
}
```

`files` (the files each block will touch, so a person sees them before approving):

<!-- placement-example:files -->
```json
{
  "b1": [
    "features/billing/domain/SubscriptionPlan.tsx",
    "features/billing/services/SubscriptionPlan.tsx",
    "features/billing/controllers/SubscriptionPlanController.tsx"
  ],
  "b1-view": [
    "features/billing/components/SubscriptionPlan.tsx",
    "features/billing/pages/SubscriptionPlanPage.tsx"
  ],
  "b2": [
    "features/billing/hooks/useClickButton.tsx",
    "features/billing/controllers/SubscriptionPlanController.tsx"
  ],
  "b3": [
    "features/billing/services/ManageBillingDetails.tsx",
    "features/billing/workflows/ManageBillingDetails.tsx"
  ]
}
```

## The two other examples

<!-- placement-example:overview-code -->
```js
import { parseRequirement } from '@line/construct-core/requirement-card';
import { placeCard } from '@line/construct-core/placement';

const lines = (text) => placeCard(parseRequirement(text).card).blocks
  .map((b) => `${b.id} ${b.label}: ${b.placement} (${b.layers.map((l) => `${l.layer} ${l.name}`).join(', ')})`);

export const overview = {
  upload: lines('A user wants to upload a profile picture and see it update instantly.'),
  search: lines('A customer wants to search products with instant keyboard filtering.'),
};
```

<!-- placement-example:overview -->
```json
{
  "upload": [
    "b1 upload profile picture: client-leaf (hook UploadProfilePicture, controller ProfilePicture)",
    "b2 see profile picture: presentational (component ProfilePicture, page ProfilePicture)",
    "b3 update profile picture: mutation (service UpdateProfilePicture, workflow UpdateProfilePicture)"
  ],
  "search": [
    "b1 search products: presentational (component Products, page Products)",
    "b2 filtering products keyboard: client-leaf (hook FilteringProducts, controller Products)"
  ]
}
```

"Upload a profile picture and see it update instantly": the upload is an event handler (client leaf), showing the picture is
props-fed (presentational), and updating it writes a database row (mutation); "instantly" is `latency-budget` on all three.
"Search products with instant keyboard filtering": the keyboard is an interactive part, so filtering is a client leaf; the
product list is presentational.

## Open questions, never guesses

A case the rules cannot decide is a closed question of 2-5 options in the shape of a chooser summary
(`{ id, question, options: [{ id, label, enabled, why }], chosen }`), so a decision provider can `suggest` an option and a
person confirms. The block waits (`complete: false`) until it is answered:

| Question id | Raised when | Options |
|---|---|---|
| `q-<verb id>` | a write verb names no data object or outside service ("save a form") | `mutation`, `client-leaf` |
| `q-<check id>` | a check the table does not know (`CHECK_RULES`) | `server-blocks`, `screen-blocks`, `every-block` |
| `q-server` | a server-side check with no server block ("click a button safely") | `mutation`, `server-read` |

`resolvePlacementOpen(card, { 'q-server': 'mutation' })` (or `{ option, by: 'decision-model', provider: 'jev' }`) places the
card again with the answer; an unknown question or option is a typed error (`PLACE_UNKNOWN_OPEN`, `PLACE_UNKNOWN_OPTION`).
Who answered is returned as `decisions` and passed to `planFromBlocks({ decisions })`, which returns it beside the plan the
way `compileChain` does. A card that still has its own open words is refused (`PLACE_CARD_OPEN`): answer those with
`resolveOpen` first.

## The list shape: a screen that works, not a stub (#619, part of #616)

Without a shape, a plan's files are empty scaffolds with a TODO in each. A **shape** is a named recipe whose typed templates
(`packages/core/shapes.mjs`) fill the units of a feature with real code, so confirming the plan gives a screen that works.
`list` is the first: a screen that lists the items of an entity, with loading, empty and error states. No model is involved:
the same request writes the same bytes, and a second run changes nothing.

**The offer.** When the card asks for one list (the card's one verb is a read, its one data object is named in the plural
by the lexicon's own test, `products` for the entry `product`, and the screen is named after it) `placeCard` adds a closed
question to `result.offers` (not to `open`, so it never holds the plan back):

| Question id | Raised when | Options |
|---|---|---|
| `q-shape` | one read verb on one plural data object, every block presentational or a server read ("see a list of products") | `list` (the rules-only default), `scaffold` |

(#620 and #626 added the same question for a read of one item (`detail`) and a write with properties (`form`): the options belong to the card, see "The detail and form shapes" below.)

An unanswered offer leaves the plan exactly as it was, the plain scaffold. Answering `list` (a person, or the rules provider's
suggestion, recorded in `decisions` as `person` or `decision-model`) turns the read into a server-read block (domain, service,
hook, controller) plus the presentational block that shows it (component, page), and every `create.unit` step of the plan
carries the three new optional arguments `shape`, `entity` and `fields` (`--shape list --entity Product --fields ...` on the
command; and, since #621, `source`, where the screen reads its data from, see "The data source" below). The entity is the singular of the plural noun; the fields are the card entity's properties, typed by their names
(`price` and `amount` are numbers, `isActive` a boolean, the rest strings) after an `id`. A search, a write, or two data objects
in one card is not offered the shape: those are later slices. The Cockpit's `POST /api/requirement/read` returns the offer as
`offers` and takes the answer as `{ id: 'q-shape', option: 'list' }`; the Requirement screen draws it (#651) as a small **Screen shape** card between the placement blocks and the timeline: the two
options as buttons ("List screen, generated with typed code", "Empty scaffold"), the rules' default marked "suggested", one plain
line on what each gives, and, once a person has chosen, "Decided by: person". Nothing is preselected: an unanswered offer leaves
the plain scaffold on screen, Approve stays on and approves exactly that plan; choosing re-reads with the answers extended by
`{ id: 'q-shape', option }`, so the plan preview, the timeline and the files list redraw (Approve waits while that read is in flight).

**Worked example, run by `test/shapes.test.mjs` so it cannot go stale:**

<!-- list-shape-example:code -->
```js
import { parseRequirement } from '@line/construct-core/requirement-card';
import { placeCard, planFromBlocks } from '@line/construct-core/placement';
import { planToCommand } from '@line/construct-core/plan';

const { card } = parseRequirement('A user wants to see a list of products');

// 1. Placement makes the offer. It is a closed question that does not hold the plan back.
const offered = placeCard(card, { framework: 'react-spa' });
const [offer] = offered.offers;

// 2. Answer it (a person, or the rules provider's suggestion), and compile the plan.
const placed = placeCard(card, { framework: 'react-spa', answers: { [offer.id]: { option: offer.default, by: 'decision-model', provider: 'rules' } } });
const planned = planFromBlocks(placed.blocks, { feature: 'products', root: '/path/to/project', decisions: placed.decisions });

export const question = { id: offer.id, question: offer.question, options: offer.options.map((o) => o.id), default: offer.default, entity: offer.entity, fields: offer.fields };
export const decisions = placed.decisions;
export const commands = planned.plan.steps.map((step) => `construct ${planToCommand(step).argv.join(' ')}`);
export const files = planned.files;
```

<!-- list-shape-example:question -->
```json
{
  "id": "q-shape",
  "question": "How should the \"products\" screen be built?",
  "options": ["list", "scaffold"],
  "default": "list",
  "entity": "Product",
  "fields": "id:string,name:string,price:number"
}
```

<!-- list-shape-example:decisions -->
```json
[{ "question": "q-shape", "option": "list", "by": "decision-model", "provider": "rules" }]
```

The thirteen commands the plan runs (each is a step `planToCommand` turns into a real command; the fields are the same on every unit; the three after the units wire the screen, see "The route entry, sync and the dependency"; then the type-check, see "Type-check, build and environment variables"; the last two are the proof of the screen, see "The proof step"):

<!-- list-shape-example:commands -->
```json
[
  "construct create feature products",
  "construct create domain Products --feature products --shape list --entity Product --fields id:string,name:string,price:number --source local",
  "construct create service Products --feature products --shape list --entity Product --fields id:string,name:string,price:number --source local",
  "construct create hook Products --feature products --shape list --entity Product --fields id:string,name:string,price:number --source local",
  "construct create component Products --feature products --shape list --entity Product --fields id:string,name:string,price:number --source local",
  "construct create page Products --feature products --shape list --entity Product --fields id:string,name:string,price:number --source local",
  "construct create controller Products --feature products --shape list --entity Product --fields id:string,name:string,price:number --source local",
  "construct create dependency @line/construct-core --version ^0.9.0",
  "construct sync",
  "construct create route Products --feature products --route /products",
  "construct test types",
  "construct create proof Products --feature products --shape list --entity Product --fields id:string,name:string,price:number --source local --kind render",
  "construct test proof products --name ProductsScreen.proof.test.ts"
]
```

The files each step declares (`touches`) and writes, by block (the approval gate refuses any file a step did not declare):

<!-- list-shape-example:files -->
```json
{
  "b1": [
    "features/products/domain/Products.domain.ts",
    "features/products/domain/ProductsStore.domain.ts",
    "features/products/types.ts",
    "features/products/services/Products.service.ts",
    "features/products/hooks/useProducts.state.ts",
    "features/products/controllers/ProductsController.controller.tsx"
  ],
  "b1-view": [
    "features/products/components/ProductRow.component.tsx",
    "features/products/components/ProductList.component.tsx",
    "features/products/components/ProductsNotice.component.tsx",
    "features/products/pages/ProductsPage.page.tsx",
    "features/products/expressions/ProductsByStatus.expression.tsx"
  ]
}
```

**What each file is.** Every unit is built with the typed factory of its layer and is named `Name.layer.ext` (rule READ-004),
so the output passes `construct validate` with the typed-contracts phase 1 rules on (HOOK-001, PAGE-008/009, DOMAIN-002,
READ-004, plus SERVICE-003 and STATE-001) with no error and no warning, and `tsc --noEmit`:

| File | What it holds |
|---|---|
| `types.ts` (appended by the domain step) | `Product { id; name; price }`, `ProductsState` (a `status` union: loading, ready with items, error with a message) and `ProductsResult`. A declaration already in the file is kept. |
| `domain/Products.domain.ts` | `sortProducts`, a pure selector built with `defineDomain`: the rows ordered by the title field, the list it is given unchanged. |
| `services/Products.service.ts` | `fetchProducts`, built with `defineService`: takes the caller's `AbortSignal`, forwards it to `fetch('/api/products')`, checks the shape of every row, and answers a typed `ProductsResult`; a failed request, a bad status or a wrong shape is an error result, never a throw. |
| `hooks/useProducts.state.ts` | `useProducts()`: `useTrackedState` for the state, one effect that calls the service and aborts on unmount, sorts with the domain function. |
| `components/ProductRow`, `ProductList`, `ProductsNotice` `.component.tsx` | The row (`<li>`, the title field and the other fields), the list (`<ul>`) and a notice (`role="status"` or `role="alert"`), each with `defineComponent`. |
| `pages/ProductsPage.page.tsx` | `definePage`: a heading and the expression, from props. It holds no conditional JSX, so PAGE-008 and PAGE-009 pass. |
| `expressions/ProductsByStatus.expression.tsx` | `defineExpression`: loading notice, error notice, its children when there are no rows (the page says "No products yet."), else the rows. This is where the branches live. |
| `controllers/ProductsController.controller.tsx` | `defineController`: calls `useProducts()` and renders the page with the state; no logic of its own. On Next.js the hook and the controller start with `'use client'`. |

**On the CLI**, the same shape on its own, without a plan:

```sh
construct create layer Products --feature products \
  --layers domain,service,hook,component,page,controller \
  --shape list --entity Product --fields id:string,name:string,price:number
```

`--entity` defaults to the singular of the unit name, `--fields` to `id:string,name:string`. A layer set that would leave an
import dangling (a `service` without the `domain` whose types it imports) is refused before anything is written, naming the
layers to add. `--shape` cannot be combined with `--llm`. The generated units import `@line/construct-core/typed-contracts`,
so the project needs `@line/construct-core` in its dependencies (the command says so when it does not have it). By hand
afterwards, once: serve the `/api/products` endpoint. In a plan the rest is steps: the dependency line, `construct sync` (the
feature's `index.ts` exports the new units) and the route entry are planned after the units (#654, below); on the bare CLI
`construct create layer` you run `construct sync` and `construct create route` yourself.

**Decisions where the issue was silent.** The shape's `types.ts` edit is declared as a `modify` of the file the feature step
created. The expression is written by the page step, since a page may not hold conditional JSX and `LAYER_ORDER` has no
`expression` layer. The shape fetches in the browser, so it uses the default layer table even on Next.js (no Server
Component). `DOMAIN-002` used to flag the `defineDomain` import itself; it now allows that one factory from a typed-contracts
module. A project's own custom `templates/` are not used for a shaped unit.

## The detail and form shapes: one item, and a form that submits (#620, #626, part of #616)

`detail` and `form` are two more shapes on the mechanism the list shape introduced: the same `--shape <name> --entity <Entity> --fields
<name:type,...>` arguments on `create.unit`, `create.layer` and `create.proof` (the enum is `PLAN_SHAPES`, mirrored in
`schemas/plan.v1.json`; a test keeps the two and the shape table in `packages/core/shapes.mjs` equal), the same derived `touches`, the
same wiring (dependency, `sync`, route entry, see below) and the same proof step, the same `q-shape` id in the same chooser shape, with
its options **per card**. Every unit is built with the factory of its layer (`defineDomain`, `defineService`, `defineComponent`,
`defineExpression`, `definePage`, `defineController`, `useTrackedState`) and is named `Name.layer.ext`; the output passes
`construct validate` with the typed-contracts phase 1 rules on (no error, no warning) and `tsc --noEmit`. The templates live in
`shape-detail.mjs` and `shape-form.mjs`; nothing calls a model or the network, and the same request writes the same bytes.

**The offer, by card.** `placeCard` raises `q-shape` (in `offers`, never in `open`) with the options that belong to the card, the matching
shape first, so the rules-only decision provider (the first enabled option) suggests it. An answer that is not an option of *this* card
(`list` for a single read) is `PLACE_UNKNOWN_OPTION`. At most one shape is offered per card; a card that is none of them gets no offer.

| Card | Rule (data, not a guess) | Options | Unit and entity |
|---|---|---|---|
| a list | one read verb on one **plural** data object ("see a list of products") | `list`, `scaffold` | unit `Products`, entity `Product` |
| one item | one read verb on one **singular** data object, not the person's own (a possessive before it, or "current", is found from the session, not by an id) and with no `list` or `table` part ("the invoice list" is many): "see the details of a product", "view a product" | `detail`, `scaffold` | unit `Product`, entity `Product` |
| a write | one write verb of `create`, `add`, `submit`, `save`, `register`, `update` on one singular data object **that has properties** ("add a product with a name and a price") | `form`, `scaffold` | unit `AddProduct` (the verb and the object), entity `Product` |

To parse those sentences with no open question the lexicon (`requirement-lexicon.json`) gained the write verbs `add` and `register`
and the screen parts `detail`, `name` and `price` (the fields of the form the card's entity already lists). A delete, a data object
without properties, a plural, two verbs or a verb that needs the browser (a click) is not offered a shape.

**Worked example, the detail shape, checked by `test/detail-shape.test.mjs`.** "A user wants to see the details of a product"
answered `detail` (by the rules provider) gives thirteen commands; the files are declared by block:

<!-- detail-shape-example:commands -->
```json
[
  "construct create feature product",
  "construct create domain Product --feature product --shape detail --entity Product --fields id:string,name:string,price:number --source local",
  "construct create service Product --feature product --shape detail --entity Product --fields id:string,name:string,price:number --source local",
  "construct create hook Product --feature product --shape detail --entity Product --fields id:string,name:string,price:number --source local",
  "construct create component Product --feature product --shape detail --entity Product --fields id:string,name:string,price:number --source local",
  "construct create page Product --feature product --shape detail --entity Product --fields id:string,name:string,price:number --source local",
  "construct create controller Product --feature product --shape detail --entity Product --fields id:string,name:string,price:number --source local",
  "construct create dependency @line/construct-core --version ^0.9.0",
  "construct sync",
  "construct create route Product --feature product --route /product",
  "construct test types",
  "construct create proof Product --feature product --shape detail --entity Product --fields id:string,name:string,price:number --source local --kind render",
  "construct test proof product --name ProductScreen.proof.test.ts"
]
```

<!-- detail-shape-example:files -->
```json
{
  "b1": [
    "features/product/domain/Product.domain.ts",
    "features/product/domain/ProductStore.domain.ts",
    "features/product/types.ts",
    "features/product/services/Product.service.ts",
    "features/product/hooks/useProduct.state.ts",
    "features/product/controllers/ProductController.controller.tsx"
  ],
  "b1-view": [
    "features/product/components/ProductDetailRow.component.tsx",
    "features/product/components/ProductDetails.component.tsx",
    "features/product/components/ProductNotice.component.tsx",
    "features/product/pages/ProductPage.page.tsx",
    "features/product/expressions/ProductByStatus.expression.tsx"
  ]
}
```

| File | What it holds |
|---|---|
| `types.ts` (appended by the domain step) | `Product { id; name; price }`, `ProductDetailEntry { field; label; value }`, `ProductDetailState` (a `status` union: `loading`, `not-found`, `ready` with the item and its lines, `error` with a message) and `ProductDetailResult` (what the service answers). |
| `domain/Product.domain.ts` | `describeProduct`, a pure `defineDomain` unit: one line per field, in field order, with its label (`unitPrice` reads "Unit price") and its text (a boolean reads Yes or No). |
| `services/Product.service.ts` | `fetchProduct({ id, signal })`, built with `defineService`: forwards the caller's `AbortSignal` to `fetch('/api/products/<id>')` (the id is URL-encoded), a **404 is `not-found`**, and a failed request, another bad status or a wrong shape is a typed error result, never a throw. |
| `hooks/useProduct.state.ts` | `useProduct(id?)`: `useTrackedState` for the status union; the id is the argument, else `?id=` of the address (with neither, the item is `not-found`); one effect calls the service, describes the item with the domain function and aborts on unmount. |
| `components/ProductDetailRow`, `ProductDetails`, `ProductNotice` `.component.tsx` | One field as `<dt>` and `<dd>`, the `<dl>` they sit in, and a notice (`role="status"` or `role="alert"`). |
| `pages/ProductPage.page.tsx`, `expressions/ProductByStatus.expression.tsx` | The heading ("Product details") and the expression that holds the branches: loading notice, its children (the page says "Product not found.") when there is no such item, an error notice, else every field. |
| `controllers/ProductController.controller.tsx` | `defineController<{ id?: string }>`: calls `useProduct(id)`, renders the page; no logic of its own. On Next.js the hook and the controller start with `'use client'`. |

**The id.** The route entry renders the controller and nothing else (ROUTE-001, ROUTE-002), so the screen needs no route parameter:
the controller takes an optional `id` prop, and without it the hook reads `?id=` from the address (`/product?id=p1`). A screen that
sits in a route with a parameter passes it as the prop.

**Worked example, the form shape, checked by `test/form-shape.test.mjs`.** "A user wants to add a product with a name and a price" answered `form`:

<!-- form-shape-example:commands -->
```json
[
  "construct create feature add-product",
  "construct create domain AddProduct --feature add-product --shape form --entity Product --fields id:string,name:string,price:number --source local",
  "construct create service AddProduct --feature add-product --shape form --entity Product --fields id:string,name:string,price:number --source local",
  "construct create hook AddProduct --feature add-product --shape form --entity Product --fields id:string,name:string,price:number --source local",
  "construct create component AddProduct --feature add-product --shape form --entity Product --fields id:string,name:string,price:number --source local",
  "construct create page AddProduct --feature add-product --shape form --entity Product --fields id:string,name:string,price:number --source local",
  "construct create controller AddProduct --feature add-product --shape form --entity Product --fields id:string,name:string,price:number --source local",
  "construct create dependency @line/construct-core --version ^0.9.0",
  "construct sync",
  "construct create route AddProduct --feature add-product --route /add-product",
  "construct test types",
  "construct create proof AddProduct --feature add-product --shape form --entity Product --fields id:string,name:string,price:number --source local --kind render",
  "construct test proof add-product --name AddProductScreen.proof.test.ts"
]
```

<!-- form-shape-example:files -->
```json
{
  "b1": [
    "features/add-product/domain/AddProduct.domain.ts",
    "features/add-product/domain/AddProductStore.domain.ts",
    "features/add-product/types.ts",
    "features/add-product/services/AddProduct.service.ts",
    "features/add-product/hooks/useAddProduct.state.ts",
    "features/add-product/controllers/AddProductController.controller.tsx"
  ],
  "b1-view": [
    "features/add-product/components/AddProductField.component.tsx",
    "features/add-product/components/AddProductForm.component.tsx",
    "features/add-product/components/AddProductNotice.component.tsx",
    "features/add-product/components/AddProductAgain.component.tsx",
    "features/add-product/pages/AddProductPage.page.tsx",
    "features/add-product/expressions/AddProductByStatus.expression.tsx"
  ]
}
```

| File | What it holds |
|---|---|
| `types.ts` (appended by the domain step) | `ProductInput { name; price }` (the typed values), `AddProductValues { name; price }` (what a person types: text for a string or a number field, a tick for a boolean), `AddProductErrors` (a message per field), `AddProductValidation` (`{ ok: true; input } \| { ok: false; errors }`), `AddProductState` (a `status` union: `editing` with values and errors, `submitting`, `submitted`, `error` with values and a message) and `AddProductResult`. |
| `domain/AddProduct.domain.ts` | `validateAddProduct`, a pure `defineDomain` unit: a string field is **required**; a number field is required (a blank is not zero) and must be a number ("Price must be a number."); a boolean field has no check. Answers the typed values (text trimmed, numbers as numbers) or a message per field. |
| `services/AddProduct.service.ts` | `submitAddProduct({ input, signal })`, built with `defineService`: **POSTs** the typed values as JSON to `/api/products`, forwards the `AbortSignal`, answers a typed `AddProductResult`; a bad status or a failed request is an error result, never a throw. |
| `hooks/useAddProduct.state.ts` | `useAddProduct()`: `useTrackedState` for the status union, and `change`, `submit` (check, then POST, ignored while submitting) and `reset`; a request in flight is aborted on unmount. |
| `components/AddProductField`, `AddProductForm`, `AddProductNotice`, `AddProductAgain` `.component.tsx` | A label, its input and a live region for the message; the `<form>` with one typed input per field (`type="text"`, `type="number"`, a checkbox) and a submit button; a notice; the "Add another" button. |
| `pages/AddProductPage.page.tsx`, `expressions/AddProductByStatus.expression.tsx` | The heading and the expression that holds the branches: its children (the "Product added." notice and the button) once submitted, else the form (disabled with a "Saving..." notice while it submits, an error notice with role alert when it failed, its messages after a failed check). |
| `controllers/AddProductController.controller.tsx` | Calls `useAddProduct()`, renders the page with the state and the three handlers; no logic of its own. |

**Decisions where the issue was silent.** The form has an input for every field **except `id`**, which the server assigns (a card's
fields always start with `id:string`); a form needs at least one other field. Every write verb of the offer POSTs to
`/api/<entities>` (an `update` is a POST of the values too: there is no id to address); a PUT with the id is a later slice. The
unit of a form is named for the verb and the object (`AddProduct`), so a page for the object itself (`Product`, the detail) and a
form can sit in one project without clashing; the entity is the unit name without its leading write verb (`--entity` overrides).
The endpoint of a detail and a form is the plural of the entity (`Product` gives `/api/products`), not of the unit name.

## The data source: where a screen reads its data from (#621, part of #616, relates to #400)

Until now the service of a shaped screen called `/api/<plural>`, an endpoint nothing in the project had made, so the screen it
generated could not show data on its own. The person now chooses where the screen reads from, as one closed question, and the
units are generated to match. Nothing calls a model or the network.

**The question.** `planFromBlocks` adds `q-source` (`q-source-<name>` when a plan has several shaped screens) to `result.offers`,
one per shaped screen, in the shape of a chooser summary (`{ id, question, options: [{ id, label, enabled, why }], default, chosen }`
plus `unit`, `shape` and the rules' `suggestion`). It never holds the plan back: an unanswered question uses its default.

| Option | Offered when | What the screen reads from |
|---|---|---|
| `openapi` | the project has `openapi.yaml`, `openapi.yml` or `openapi.json` at the root or in `api/`, and it has the operation of the entity: `GET` on a path ending in the plural (list), `GET` on that path plus one `{parameter}` (detail), `POST` on the plural (form) | the path of that operation, with the spec's first server path as prefix (`/v1/products`); the service names the operation and the file in a comment |
| `local` | always | a typed in-memory store: seed rows in a second domain file (`ProductsStore.domain.ts`), held and read by the service, so the screen works with no backend |
| `endpoint` | always | `GET`/`POST /api/<plural>`, the behaviour of a shaped step before #621; the endpoint must exist in your app, nothing in the plan creates it |

The rules-only default is the first option offered: `openapi` when a matching operation exists, else `local`. A spec that has a
file but not the operation leaves `openapi` out and the plan's notes say why; an answer that was not offered (`openapi` with no
spec, an unknown option) is a typed `PLAN_SOURCE_UNAVAILABLE`, never replaced by another source. The answer is recorded like every
other closed choice (`requirement.plan.source`, `choicesFromWiring`, `docs/DECISION-TRACES.md`) and is replayable.

**The mechanism.** `--source local|endpoint|openapi` on `construct create layer|<layer> ... --shape ...` and `construct create proof`
(`PLAN_SOURCES` in `plan.mjs`, mirrored in `schemas/plan.v1.json`; a test keeps the enum, the schema and the source module equal). It is
optional and additive: **no `--source` means `endpoint`**, so every plan and command written before #621 gives the same bytes, while the
Requirement chain's default is the rules-only default above. The plan carries `source` on every unit step of a screen and on its proof
step, and a step declares the extra store file in its `touches` (the approval gate refuses any file a step did not declare).

| Source | Files it writes beyond the endpoint source | The service |
|---|---|---|
| `local` | `domain/<Name>Store.domain.ts` (`defineDomain` units: the seed rows, and a pure read, find or save over a set of rows); the form's `types.ts` also gains the row type | no `fetch`; keeps the rows in module state, takes the caller's `AbortSignal` and answers the same typed result (a cancelled request is an error result) |
| `endpoint` | none | unchanged |
| `openapi` | none | the endpoint service with the spec's path and a `// Data source: GET /products (listProducts) of openapi.yaml.` line; with no matching operation the request is refused before anything is written |

The store is pure where the rules need it (`DOMAIN-002`): the domain units take rows and return rows, and only the service holds the
mutable array. `openapi` reads the spec with the reader `create service --openapi` uses (`packages/core/openapi-spec.mjs`); it does **not**
emit the RTK Query file of `create.service.openapi`, because that service needs a Redux store and provider the shaped hook does not have
(the shaped hook awaits a `fetch*` service and holds the result in tracked state). The typed result and the runtime shape check of the
service are the same for the two network sources.

**The proofs adapt.** The render proof stubs the source the way it is wired: `endpoint` is unchanged; `openapi` adds a test that the
service asks the spec's path (detail and form already assert the address); `local` drives the store with fetch made to throw, asserts the
seed rows (list), a seeded id and an unknown id (detail), that a submit saves one more row with a fresh id and leaves the rows it was given
alone (form), and that a cancelled request is an error result. A local source makes no request, so it has no browser flow to mock: the plan
plans none and says so; `openapi` mocks the spec's path.

**The Requirement API and screen.** `POST /api/requirement/read` returns `q-source` in `offers` (source `plan`) once the plan is built, takes
the answer as `{ id: 'q-source', option }` like `q-shape`, attaches the decision provider's suggestion and records the choice. The
Requirement screen draws it generically as a second card, **Data source**, after the shape card (test ids `requirement-source*`, the
suggested option marked, "Decided by: person" once chosen); Approve never waits for it.

**Left out on purpose** (each a later slice): auth, pagination and write-through caching; a store shared by the list and the form of one
entity (each screen has its own in-memory store, so a submitted row does not show on a list); persisting the local store (localStorage,
IndexedDB); reading the entity's fields from the spec's schema instead of `--fields` (the runtime shape check uses `--fields`); an
OpenAPI operation with more than one path parameter or a nested collection; the RTK Query service as a screen's source; `servers`
with variables or another origin than the app's own (only the path is used); a Playwright flow for a local source.

## The proof step: a screen that is shown to work (#623, part of #616)

A chain that ends with files that validate and type-check has not shown the screen behaves. A shaped plan therefore ends with a
**proof** (`packages/core/proof.mjs`, `packages/engine/proofRunner.mjs`), a deterministic step of the chain with no model in it.
`planFromBlocks` adds it by default to a plan with a shaped unit (`{ proof: false }` leaves it out, the plan is then as it was
before #623):

| Step | Flow | What it does |
|---|---|---|
| `s11` Prove the Products screen | `create.proof` (`--kind render`) | Writes `features/<f>/tests/generated/ProductsScreen.proof.test.ts` (and, once, declares the `frozen:` and `nonLayer:` test regions in `architecture.yml`, which the step lists in its `touches`). |
| `s12` Run the proof of Products | `test.proof` (read-only) | Runs it and answers a pass, or a classified failure. |
| `s13`, `s14`, only with Playwright | `create.proof --kind playwright --route /products`, `test.run` | The route flow (of the route the plan wired) with a mocked API, and its run against your running app. |

**The render proof** needs nothing a `construct init` project does not have: react, react-dom and `esbuild` (it comes with `tsx`
and with `vite`, both in the init `package.json`). `construct test proof <feature>` bundles the proof with the project's own
esbuild into a throwaway temp directory and runs it with `node --test`: no browser, no server, no network, nothing written in
the project, no new dependency in Construct. A project without esbuild is told to `npm install -D tsx`; the file also runs on its
own with `npx tsx --test <file>`, like the every-path unit tests. The file is named `Name.proof.test.ts` (READ-004's `Name.layer.ext`),
carries the generated-test marker (edits are refused, so the proof cannot be edited until it is green), is a pure function of
(unit name, entity, fields), and passes `construct validate` because it sits in the `nonLayer` test region. It asserts, from
sample rows built out of the entity's fields:

- the four states of the page: **loading** (`role="status"`), **empty**, **items** (each row's exact markup, the title in
  `<strong>` and every other field as `name: value`) and **error** (`role="alert"` with the message);
- that the **controller** renders the loading state first, and hands the hook state to the page unchanged;
- that the **service**, with a stubbed `fetch`, answers a good list with the rows, and a **500**, a **wrong shape** (not a list,
  and a row of the wrong type) and a **network failure** with an error result, and forwards the caller's `AbortSignal`.

**A failure names the state.** Every assertion fails with `Expected: "empty"` / `Received: "blank"` lines, so the runner reuses the
Playwright runner's classification (`classifyFailure`) and its words:

| Kind | Meaning | Example |
|---|---|---|
| `app` | The screen reached another state than the proof expects. A bug worth reporting. | `The page given no rows: the empty state is wrong, the screen shows blank.` (the empty branch of the expression was removed) |
| `convention` | A file or export the proof binds to is gone. Not a product bug. | `The proof expected ../../pages/ProductsPage.page, and it is not there.` |
| `other` | Anything else, shown as it is. | |

The states are `loading`, `empty`, `items`, `error`, and for what is wrong `blank` (a list with no rows and no message) or `nothing`.

**The proof of the other shapes** (#620, #626; `packages/core/proof-screens.mjs`, the same file name `Name.proof.test.ts`, the same
locked marker, the same `construct test proof <feature>`, the same failure classes). The render proof needs nothing more; a failure names the
state in the same words:

| Shape | What it asserts (sample values built from the entity's fields) | States it names |
|---|---|---|
| detail | the page in `loading`, `not-found`, `ready` (every field's `<dt>` label and `<dd>` value) and `error` (`role="alert"`); the controller renders `loading` first (with or without the `id` prop); the domain lines in field order; the service with a stubbed `fetch`: a good answer, a **404 is not-found**, a 500, a wrong shape and a network failure are typed results, the id is in the address (URL-encoded) and the `AbortSignal` reaches `fetch` | `loading`, `not-found`, `ready`, `error`; `crashed` (the page threw), `nothing` |
| form | every field with its `<label for>` and a typed input (`text`, `number`, `checkbox`); the check gives typed values for valid input and a **message per invalid field** (a blank number is required, not zero); the page shows that message beside the field (`aria-invalid="true"`); the `submitting` (disabled), `submitted` and `error` (role alert, what was typed kept) states; the controller renders `editing` first; the service, with a stubbed `fetch`, **is called with the typed values** (POST, JSON, numbers as numbers), a 500 and a network failure are error results and the `AbortSignal` reaches `fetch` | `editing`, `invalid`, `submitting`, `submitted`, `error`; `valid` (of the check); `crashed`, `nothing` |

A page that throws (for example a branch of the expression was removed and the page reads what that state does not have) is reported as the
state `crashed`, not as a stack trace: `The page given status not-found: the not-found state is wrong, the screen shows crashed.` The route flow
(`--kind playwright`) exists only for the list shape (`PLAYWRIGHT_SHAPES`): for the others `construct create proof --kind playwright` prints
`Skipped: ...`, a plan in a project with Playwright plans no browser step and says so in `notes` and `proof.playwright.skipped`.

**The chain is complete when the proof is green or explicitly skipped.** `planFromBlocks` returns `proof`:
`{ required: true, complete: false, state: 'pending', steps, verifiedBy: ['s12'], playwright: { configured, config, skipped } }`, and
`notes` holds what was left out. `proofStatus(entries)` (pure) takes what each `verifiedBy` step answered (`runProofs`, `runFeatureTests`,
`{ skipped: 'why' }` or nothing yet) and answers `{ complete, state: pending|failed|green|skipped, steps }`: any step still pending or failed
keeps the chain open, a run that found no test proves nothing, and only green or an explicit skip completes it. `proofSummary(run)` is the
fixed-size, AI-ready summary (`proof-summary.v1`: state, counts, at most five failures with the state that is wrong, and closed option
ids: `edit-code` (View/edit code), `fill-with-ai` (a reviewable diff), `regenerate-screen`, `skip-proof`, `run-proof`), so a person, an LLM or a
decision model receive the same thing and the proof stays the referee.

**Playwright is never installed for you.** The browser flow is planned only when the project already has a `playwright.config.*` at
its root; otherwise the plan says so (`proof.playwright.skipped`, and the same sentence in `notes`), `construct create proof --kind
playwright` prints `Skipped: ...` and writes nothing, and the render proof still proves the screen. The flow (`<name>--screen.spec.ts`, a
locked generated spec `construct test run` already finds) mocks `/api/products` with `page.route`, holds the answer back to see the loading
state, then checks the list, the empty state and the error state with `role="alert"`, reading the state off `<main>` in the same words as the
render proof. Its route is `--route` (default `/`). It is exercised for real in `test/proof.test.mjs` (opt-in: `CONSTRUCT_RUN_PLAYWRIGHT=1`).

```sh
construct create proof Products --feature products --entity Product --fields id:string,name:string,price:number
construct test proof products          # exit 0 green, 1 a failed test, 2 it could not run
construct test proof products --format json
```

**Decisions where the issue was silent.** The proof lives in `tests/generated/` (the generated-test region, locked by `frozen:`), not
in a layer folder, so it can reach across layers without an exemption. The step declares `architecture.yml` as a `modify` because
adding the regions is part of the step, not a manual chore (a half-declared project is refused, nothing rewritten). The render
proof is a `.test.ts` (the project's `test:unit` glob and `tsx --test` find it) and is bundled by the runner rather than run through
`tsx`, because esbuild is the one loader every init project has and it works offline. A skip is an input to `proofStatus`, not a
command flag: the runner (or the Cockpit) records it, so it stays visible.

**The Requirement screen draws the proof (#653).** `POST /api/requirement/read` now also returns `proof` (the plan's proof steps and the
chain state, `pending`), and a shaped plan gets a "6. Prove the screen" card after "5. Approve": the state (`pending | green | failed |
skipped`, a word and a symbol), the chain summary (`complete (proof green: 10 passed)`, `complete (proof skipped: <reason>)` or
`incomplete (...)`, never a plain "complete"), and for a failure the classified message in the Tests screen's words (`app`: "The app
behaved differently", with the failing state, for example `empty`, and what the screen reached; `convention`: "Harness problem, not
a product bug"). The buttons are the closed options of `proofSummary`: **Run the proof** and **Skip the proof** work; **Edit code**,
**Fill with AI** and **Regenerate the screen** show what they will do and stay off until their Cockpit exits exist. Approving the plan
and running the proof are separate, visible steps: the proof runs against the files the plan wrote, so Run and Skip stay off ("Approve
the plan first") until the proof file is in the project; the card asks the server when a plan is shown and every 2 s while it is
approved and the files are not in yet. Three routes, all `POST`, below the session and project-open gates, Origin-checked, JSON only, no
path from the client (`ui/server/src/requirementProofApi.mjs`):

| Route | Body | Answer |
|---|---|---|
| `/api/requirement/proof/status` | `{ feature, plan }` | `{ applied, files, options }`: is the proof file the plan's `test.proof` step names on disk. |
| `/api/requirement/proof/run` | `{ feature, plan }` | `{ run: { state, complete, counts, failures[{ kind, summary, expected, reached, fix }], error, summary } }`. Refused with 409 `NOT_APPLIED` before the plan is applied, 409 `RUN_IN_PROGRESS` while another run of the project is going, 504 `TIMEOUT` after 90 s (the lock is held until the run really ends). |
| `/api/requirement/proof/skip` | `{ feature, plan, reason }` | `{ skipped, state: 'skipped', complete: true, reason }`. The reason is one trimmed line of 8 to 200 characters, else 400 `REASON_REQUIRED`. |

The plan is re-validated (`validatePlan`), the feature must be the one a `test.proof` step of that plan names and a feature on disk, and
what runs is `runProofs` (the block behind `construct test proof`), read-only. A run and a skip are recorded as decision traces
(`requirement.proof.next`, the closed options of `proofSummary` as offered; the outcome `testsPassed` for a run; the free text of a
skip reason is not in the trace), failure-safe. Left for later slices: the three options that are off, the browser flow (`test.run`) when
Playwright is configured, and keeping the skip across a reload (it lives in the screen and in the trace, not in the project).

## The route entry, sync and the dependency: a screen you can open (#654, part of #616)

A shaped screen used to end with two by-hand steps: point the route entry at the controller, and run `construct sync`. A shaped
plan now carries them as steps, after the units and before the proof (`planFromBlocks` option `wire: false` leaves them out, a
plan is then as it was before #654). For the products screen on a fresh `construct init` project the steps are:

| Step | Flow | What it does | Declared `touches` |
|---|---|---|---|
| `s1`-`s7` | `create.feature`, `create.unit` | the feature and the six units | as before |
| `s8` Add @line/construct-core to package.json | `add.dependency` (`construct create dependency`) | adds `"@line/construct-core": "^0.9.0"` to `dependencies`; never runs a package manager | `modify package.json` |
| `s9` Export the products feature's public API (sync) | `sync` (the existing flow) | the feature barrel exports the controller and the hook, so SLICE-003 does not warn | `modify features/products/index.ts`, `.dependency-cruiser.cjs` (`create` or `modify`) |
| `s10` Wire the Products screen into the route entry (/products) | `create.route` (`construct create route`) | see below | Next.js: `create app/products/page.tsx`; react-spa: `modify src/App.tsx` |
| `s11` Type-check the project | `check.types` (`construct test types`) | see "Type-check, build and environment variables" below | none (read-only) |
| `s12`, `s13` | `create.proof`, `test.proof` | the proof, see above | |

**The route entry** (`packages/core/wiring.mjs`). The route path is the kebab-case of the screen name (`Products` gives `/products`,
`SubscriptionPlan` gives `/subscription-plan`).
- **Next.js** creates `app/<route>/page.tsx` that imports the controller and renders it and nothing else (ROUTE-001 and ROUTE-002
  hold). The init scaffold's root `app/page.tsx` imports a `CoreController` that `construct init` never writes, which
  `construct validate` flags (IMPORT-001) and `next build` cannot resolve; when that page still is exactly the scaffold and its
  import resolves to nothing, the step removes it (declared as `delete app/page.tsx`).
- **react-spa** edits `src/App.tsx` with a minimal, line-based change: the controller's import goes after the last import, a
  `<Route path="/products" element={<ProductsController />} />` line before `</Routes>`, and the dangling `CoreController` import of
  the init scaffold with its own `<Route>` line is dropped. Everything else is kept byte for byte. A file with no `</Routes>` is
  refused with the line to add by hand; a route that already renders this controller changes nothing.
- A route that something else owns is refused (`construct create route` exits with a usage error naming it), never overwritten.

**Two closed questions**, in the chooser shape of `q-shape` (`{ id, question, options: [{ id, label, enabled, why }], default,
chosen }`) and returned by `planFromBlocks` as `offers`, so a person, an LLM or a decision model answers them the same way. Neither
holds a plan back: an unanswered question uses its rules default. An answer is passed as `planFromBlocks(blocks, { answers: {
'q-route': 'skip' } })` (or `{ option, by, provider }`) and recorded in `decisions` like any other.

| Question id | Raised when | Options (stable ids) | Default |
|---|---|---|---|
| `q-route` | the screen's path is reserved (`/api`) or already served by another page or `<Route>` | `alternate` (the first free of `/<feature>/<name>` when the feature is named otherwise, `/<name>-screen`, `/<name>-2`), `skip` (no route step: the screen stays unreachable until wired, and a note says so) | `alternate` |
| `q-dependency` | the project has a `package.json` that lists no `@line/construct-core` (the units import its typed factories) | `add-dependency` (its `line` field is the exact text added), `skip` | `add-dependency` |

`planFromBlocks` returns `{ ..., offers, wiring }`; `wiring` is `{ dependency: 's8' | null, sync: 's9', routes: [{ name, route, step, file }] }`
(`null` when nothing was wired). A Playwright proof step takes `--route` from the route the plan wired. Since #632 the Requirement
API passes and returns every closed question of the plan (`q-source`, `q-route`, `q-dependency`, `q-env`, `q-verify`) and the screen
draws each as a card (see below); an unanswered one uses its default.

**The full-path test** (`test/list-shape-chain.test.mjs`) runs the plan's own commands and nothing else in a fresh react-spa project
and in a fresh Next.js project, then asserts that every file that changed is a file the plan declared, `construct validate` reports no
error and no warning, `tsc --noEmit` passes and the proof is green.

**On the CLI:**

```sh
construct create route Products --feature products [--route /products]
construct create dependency @line/construct-core --version ^0.9.0
```

**Decisions where the issue was silent.** The dependency choice defaults to adding the line, because the screen does not compile
without it and every step still goes through the per-diff approval; `skip` is one answer away. The plan declares only its own
feature's barrel for `sync` (sync also refreshes the barrels of features that have drifted; the approval gate would refuse that).
A screen's route is one segment; nested routes come with the alternate. The init scaffold's dangling page is removed by the route
step rather than repointed, so `/` is not silently the new screen.

## Type-check, build and environment variables: a chain that proves the app still builds (#632, part of #616)

Three flows a plan, the CLI and the Requirement chain share. All three are deterministic blocks with no model; the two checks are
read-only and answer with a CLASSIFIED result, never a raw log.

| Flow | CLI | Writes | Declared `touches` |
|---|---|---|---|
| `check.types` | `construct test types [--feature f] [--format json]` | nothing | none |
| `check.build` | `construct test build [--format json]` | nothing of its own (a build writes its own output folder) | none |
| `add.env` | `construct create env <NAME> --scope server\|public [--value v] [--comment c]` | one variable in `.env.example` | `.env.example` (`create`, or `modify` when it exists) |

**`check.types`** (`packages/engine/verifyRunner.mjs`, `packages/core/verify.mjs`) type-checks the project with its OWN TypeScript
(`tsc --noEmit` over its tsconfig, the block `construct validate`'s opt-in `TYPE-001` already uses, solution-style tsconfigs included).
The result is `{ ok: true, check: 'types', status, statement, counts, files, checked, notes, feature, durationMs }`:

- `status: 'pass'`: no type error.
- `status: 'type-errors'`: `files` is the errors grouped by file, the first ten in `tsc` order, each `{ line, code, kind, message }`
  (`counts` still says how many there are: `{ errors, files, shown, omitted, byKind }`). `kind` is `missing-import` (a module or an
  export that is not there: TS2307, TS2305, ...), `unknown-name` (used but never declared or imported: TS2304, TS2552, TS2339, ...),
  `type-mismatch` (TS2322, TS2345, ...) or `other`; a fixed table of codes, no model. `statement` is the plain sentence:
  `4 type errors in 2 files: 1 missing import, 1 unknown name, 2 type mismatches (missing import: a module or an export that is not there; ...)`.
- `status: 'tool-missing' | 'no-config' | 'timeout' | 'failed'`: it could not decide (no TypeScript in the project, no `tsconfig.json`,
  `tsc` did not finish in 120 seconds). Never a pass.
- `--feature f` reports only the errors in that feature's files (the whole program is still checked: `tsc -p` takes no file list).
  A read-only check leaves nothing behind: the `*.tsbuildinfo` file an incremental tsconfig makes `tsc` write is removed.

**`check.build`** runs the project's `build` script (`npm run build`) through a BOUNDED child process: its own process group with a
clean environment, killed as a group when the timeout passes (300 seconds), and only the first and last part of its output is kept
(200 KB). The result is `{ ok: true, check: 'build', status, script, statement, errors, excerpt, exitCode, outputTruncated, durationMs }`:
`pass`; `compile-error` (the first ten `{ file, line, message }`, read from tsc lines, Next.js `./file:line:col` blocks and
Vite/esbuild/Rollup errors); `missing-script` (package.json has no `build`); `timeout`; or `failed` (a non-zero exit the patterns do
not know: the last twelve lines are kept as `excerpt`, and `failure` is the `{ kind: 'other', title, message }` object the test runners' `classifyFailure` gives an unclassified failure). It runs the
PROJECT's own script, so it runs project code, like running its tests does.

**Exit codes** of both CLI verbs: `0` for a pass, `1` when the check found a problem (errors, a compile error, a timeout, another
failure), `2` when it could not run (`tool-missing`, `no-config`, `missing-script`, an unknown `--feature`). In a plan a non-zero
step stops the run at that step, with the classified result as its output.

**`add.env`** (`packages/core/env.mjs`) adds one variable to `.env.example`: a `# comment` line and `NAME=placeholder`, appended after a
blank line, the file created when absent, the rest of it kept byte for byte, idempotent (a name already listed, with or without
`export`, changes nothing). It never writes `.env` and never writes a real value.

- **Name**: `[A-Z][A-Z0-9_]{0,63}`. **Scope** is a closed choice, `server | public`, and decides the prefix: `public` puts the framework's
  public prefix in front (`NEXT_PUBLIC_` for Next.js; **`VITE_` for react-spa**, where Vite inlines nothing else; never twice), `server`
  refuses a name that already carries one.
- **Secret-shaped names** (`SECRET`, `PASSWORD`, `TOKEN`, `PRIVATE`, `CREDENTIAL`, `API_KEY`, `ACCESS_KEY`, `SIGNING`, `SALT`, a `_KEY`
  suffix) are refused ONLY when a `--value` is supplied: with none the placeholder `your-<name>-here` is written, which is the normal case.
  A `public` variable whose name looks secret is written with a warning.
- A value is a plain token (no space, quote or `$`); a comment is one line of at most 120 characters, defaulting to who may read it.
- **CLIENT-001** (`packages/core/client-boundary.mjs`) is the reader of the other half: a `server`-scope name read as `process.env.NAME` in
  a `'use client'` file (or a file only it imports) is a violation, so a `server` variable belongs to a server action, a route handler or
  a server component, and only a `public` one may be read in the browser. `test/env.test.mjs` proves both directions.

**In the Requirement chain.** When the card's checks include `server-only-secret` or `validated-redirect`, `planFromBlocks(blocks,
{ card })` names the variables (`secretsOfCard`): `<SERVICE>_SECRET_KEY` per outside service the card names (`Stripe` gives
`STRIPE_SECRET_KEY`), and `ALLOWED_REDIRECT_ORIGINS` for a redirect. Each is a closed question in the chooser shape, and an `add.env` step
after the units (server scope, no dependency):

| Question id | Raised when | Options (stable ids) | Default |
|---|---|---|---|
| `q-env` (or `q-env-<kebab-name>` when there are several, e.g. `q-env-stripe-secret-key`) | the card calls for the variable and `.env.example` does not list it yet | `add`, `skip` | `add` |
| `q-verify` | a wired shaped plan | `types`, `types-build` (disabled, with the reason, when package.json has no `build` script), `none` | `types` (first, so the rules-only provider suggests it) |

`q-verify` puts `check.types` (and, for `types-build`, `check.build` after it) after the sync and the route steps and before the proof,
which stays last: the type-check runs once the route is wired, so a dangling import shows there. Neither question holds a plan back.
`planFromBlocks` also returns `env: [{ variable, scope, question, step }]` and `verify: { types, build }` (step ids or `null`); `wire:
false` leaves the variables and the verification out (a plan is then as it was), and `verify: false` leaves out only the verification.
A card with `server-only-secret` but no named outside service plans no variable and a note says to run `construct create env`.
Answers are decision traces: `requirement.plan.env` and `requirement.plan.verify` (`choicesFromWiring`), with the question as offered,
who chose and the rules suggestion. The Requirement API (`POST /api/requirement/read`) returns every plan question in `offers` and takes
answers by id; the screen draws each as a **Route**, **Dependency**, **Environment variable** or **Verification** card (`data-testid`
`requirement-plan`, `data-offer` the question id), the same way it draws the shape and the data source. MCP `placement_place` accepts the
same answers (`q-env`, `q-verify`, ...), attributed to the client, and returns `env` and `verify` beside `wiring`.

**Decisions where the issue was silent.** The default verification is `types`, not `none`, because a chain that cannot say whether the
app still compiles is not finished; on the fresh, offline fixtures of the chain tests the type-check honestly reports missing imports
(no `react-router-dom`, no `vite`), and the test harness takes that classified result as the step's answer. `check.types` in a plan is
whole-project, not `--feature`, because the route entry it must cover lives outside the feature. The public prefix follows the
framework, so `react-spa` gets `VITE_`. A secret-shaped name with no value is allowed (a placeholder is the safe case).

**Left out** (MVP): installing packages (`add.dependency` still only edits package.json), a lint step, CI configuration, reading the
project's environment schema, checking that a variable is read anywhere, and the `use client` directive.

## Wrap with a provider: a flow, not only an editor gesture (#631, part of #616)

`wrap.provider` (`packages/core/provider-wrap.mjs`, CLI `construct refactor wrap <Name> --feature f --provider <hook> [--dry-run] [--format json]`)
wraps a component or page with one provider of the project, so a chain can add it and it is reviewed like any other step. Deterministic, no
model, writing, idempotent, with declared touches.

**The providers** are a scan of `features/*/hooks/*Provider*` (the features folder follows `architecture.yml`): a file that calls
`defineProvider` and exports a `use<Name>Provider` hook (the shape HOOK-002 vouches for), plus the exported name of its
`ProviderComponent` (`export const CartProviderRoot = CartProvider.ProviderComponent`). A provider with no root component, or one of another
feature that its public index does not export (SLICE-002), is listed as not usable with the reason. `providersOf(root, { feature })`
returns them sorted; an id is the hook name, or `<feature>.<hook>` when two features define the same one.

**The closed question** `q-provider` (`providerOffer`, chooser summary shape, stable ids): the usable providers first, at most four, sorted by
id, then the unusable ones disabled with their `why`, then `none` ("Do not wrap"): two to five options, the default the first enabled one, so the
rules-only provider suggests a real provider when there is one. `construct refactor wrap` without `--provider` prints the same list and
writes nothing.

**The edit** is a text splice at the offsets of the element in the file's AST (`packages/ast`: `parseJsxTree`, `insertNamedImport`,
`jsxParseError`): the import of the root component (relative to the provider's file in the same feature, through the other feature's `index`
across features) and `<CartPage />` inside `<CartProviderRoot>`, on one line when the element shares its line, on lines with the indentation
kept when it stands on its own. `--dry-run` prints the diff and writes nothing; the real run re-validates the file. The file that is edited is
the CONTROLLER that renders the element (`<CartPage />` in `features/cart/controllers/*`): a route entry may import only controllers, so an
element the route renders is refused with a sentence that says to wrap inside the controller.

**Refused, with the reason and nothing changed:** a provider that is not one of the project's (the message lists them), an unusable one, an
element no controller of the feature renders, an element rendered in more than one place, a root component already imported from another
path, a result that would not parse. Already inside the root at any depth is a no-op (`Unchanged ..., <CartPage /> is already inside
<CartProviderRoot>`); wrapping with another provider nests it.

**What the Pages editor has.** `ui/server/src/pagesEditor.mjs` (#532, #533) inserts the consuming call (`const cart = useCartProvider();`) into
a page and wraps a flagged loop or condition in an Expression; neither puts a provider's root component around an element, so there was no
shared transformation to extract and the editor keeps its code and tests. This is the first provider wrap; when the editor grows one it should
call `wrapProvider` with `dryRun` for its preview.

**Decisions where the issue was silent.** The provider's own props are not filled in (`defineProvider<Props, Value>` types are not known to
a text scan): the result carries a note, and `construct test types` names any that are required, so the type-check is the safety net. The
element is named as the controller renders it (`CartPage`, the exported identifier), not by layer. The step is not raised by the Requirement
chain: nothing in a card says which provider a screen needs, so it is a flow a person, a plan or an LLM adds by name, with the closed list
as its options.

## What is not here yet

The timeline read-back and its Cockpit screen are the Requirement screen (`/requirement`, #642): `toTimeline(placement)` in `ui/client/features/requirement/domain/Timeline.ts` turns the blocks into steps in run order (a slice to move it into core, so the CLI and an LLM read the same steps, is open). Not here yet: a `use client` / `use server` directive in the generated files, and words beyond the lexicon. Each is a slice of #616.

Not here yet for the shapes (each a slice of #616): the other shapes (dashboard, wizard); a browser (Playwright) flow for the detail and form shapes (the list has one; the render proof of every shape is above); a `route.ts` handler for the endpoints the shapes call; an `update` form that addresses an item by its id (PUT), a form field other than a string, a number or a checkbox, a detail with a related list, and a route parameter for the detail's id (it is `?id=` or a prop today).

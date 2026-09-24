# The placement filter (#641, part of epic #616)

A requirement card (`docs/REQUIREMENT-CARD.md`, #640) says what the person wants: nouns, verbs, named checks. Placement says
where each verb's code belongs, by three fixed questions and two data tables, with no model: it is the step between the
card and the chooser plan (`docs/BLOCK-CONTRACT.md`, #617).

- Code: `packages/core/placement.mjs` (`@line/construct-core/placement`).
- `placeCard(card, { layers, framework, screen, answers })` gives `{ blocks, open, notes, decisions, errors }`;
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
allows (`checkPlacementImports` proves it; a page never imports a service). The route entry (`app/**/page.tsx`) is not a plan
step: the notes say to wire it by hand.

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

## What is not here yet

The sequence-diagram read-back, Cockpit rendering, a `use client` / `use server` directive in the generated files, a route
entry step, and words beyond the lexicon. Each is a slice of #616.

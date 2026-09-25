# The requirement card (#640, part of epic #616; builds on #576)

A requirement sentence is parsed like a compiler, not reasoned about. Nouns become data objects, states or UI parts; verbs
become actions (read, write, interact, navigate); business adjectives ("safely", "instantly") become named checks. Only the
wording is fuzzy, and the parser does not guess it: a word the lexicon does not know becomes a closed question of 2-5
options. A model may only propose a card (through the decision-provider seam of `docs/BLOCK-CONTRACT.md`), and a person
confirms it. Nothing here calls a model or the network.

- Code: `packages/core/requirement-card.mjs`, data: `packages/core/requirement-lexicon.json`
  (`@line/construct-core/requirement-card`).
- `parseRequirement(text, { lexicon })` gives `{ card, open, errors }`; `resolveOpen(card, answers)` gives a new card;
  `validateCard(card)` checks the schema and proves coverage; `cardSummary(card)` and `readBack(card)` are what a person,
  an LLM and a decision model read; `openQuestion(card, item)` is one open question in the shape of a chooser summary.

## The schema, `requirement-card.v1`

| Field | What it is |
|---|---|
| `source.text` | The requirement, verbatim. Every span points into it (`[from, to)`, character offsets). |
| `nouns[]` | `id` (`n1`..), `kind` (`entity`, `state`, `ui-part`, `external`), `text` as written, optional `properties`, `span`. A `state` noun says what is true of the person or the screen: a session (`logged-in`, `signed-in`, `guest`: property `session`, which makes the route guard's default signed-in, #629), a role (`admin`: property `role`, which makes it `role`) or client state (`selected items`, `selected item`: property `selection`; `shopping cart`: property `store`), which asks for a client-state store (#630). |
| `verbs[]` | `id` (`v1`..), `kind` (`read`, `write`, `interact`, `navigate`), `text`, `on` (noun ids), `span`. |
| `checks[]` | `id` (`c1`..), `name` (a check of the lexicon), `from` (the adjective as written), `span`, `why`. One adjective gives one check per name it maps to; none is dropped. |
| `open[]` | `id` (`o1`..), `text`, `span`, `slot` (`noun` or `verb`), `question`: a word the lexicon does not know. |
| `answers[]` | Present after `resolveOpen`: `{ open, text, span, slot, option }`, so a re-parse gives the same card. |

Coverage: every word of `source.text` is inside a noun, verb, check or open span, or is a stop word (markers such as
"to", "can", "via"; determiners; actors such as "user"; pronouns), or was answered "ignore". `validateCard` fails with
`CARD_COVERAGE_UNCOVERED_WORD` otherwise, and refuses a card whose text does not match its span, a verb that acts on an
unknown noun, a check that is not one of the lexicon's named checks, and every other malformation, each by a named code
(`CARD_ERROR_CODES`).

## Worked example: subscription billing

The sentence is the owner's; the test `test/requirement-card.test.mjs` runs the code below and compares its result with
the JSON, so this page cannot go stale.

<!-- card-example:code -->
```js
import { parseRequirement } from '@line/construct-core/requirement-card';

export const { card } = parseRequirement(
  'A logged-in user needs to see their current subscription plan and be able to click a button to manage their billing details safely via Stripe.',
);
```

`card` (no open questions; "safely" kept as three named checks, not dropped):

<!-- card-example:result -->
```json
{
  "version": "requirement-card.v1",
  "source": {
    "text": "A logged-in user needs to see their current subscription plan and be able to click a button to manage their billing details safely via Stripe."
  },
  "nouns": [
    {
      "id": "n1",
      "kind": "state",
      "text": "logged-in user",
      "properties": [
        "session"
      ],
      "span": [
        2,
        16
      ]
    },
    {
      "id": "n2",
      "kind": "entity",
      "text": "current subscription plan",
      "properties": [
        "planName",
        "status"
      ],
      "span": [
        36,
        61
      ]
    },
    {
      "id": "n3",
      "kind": "ui-part",
      "text": "button",
      "properties": [
        "interactive"
      ],
      "span": [
        85,
        91
      ]
    },
    {
      "id": "n4",
      "kind": "entity",
      "text": "billing details",
      "span": [
        108,
        123
      ]
    },
    {
      "id": "n5",
      "kind": "external",
      "text": "Stripe",
      "span": [
        135,
        141
      ]
    }
  ],
  "verbs": [
    {
      "id": "v1",
      "kind": "read",
      "text": "see",
      "on": [
        "n2"
      ],
      "span": [
        26,
        29
      ]
    },
    {
      "id": "v2",
      "kind": "interact",
      "text": "click",
      "on": [
        "n3"
      ],
      "span": [
        77,
        82
      ]
    },
    {
      "id": "v3",
      "kind": "write",
      "text": "manage",
      "on": [
        "n4",
        "n5"
      ],
      "span": [
        95,
        101
      ]
    }
  ],
  "checks": [
    {
      "id": "c1",
      "name": "auth-session-check",
      "from": "safely",
      "span": [
        124,
        130
      ],
      "why": "Refuse the action unless the person has a valid signed-in session, checked on the server."
    },
    {
      "id": "c2",
      "name": "server-only-secret",
      "from": "safely",
      "span": [
        124,
        130
      ],
      "why": "Keep the API key or secret on the server; it must never reach the browser bundle."
    },
    {
      "id": "c3",
      "name": "validated-redirect",
      "from": "safely",
      "span": [
        124,
        130
      ],
      "why": "Redirect only to an allow-listed address, so a crafted link cannot send the person elsewhere."
    }
  ],
  "open": []
}
```

The read-back a person confirms (`readBack(card)`, one line per noun, verb and check):

```
"logged-in user" is a state of the user: session.
"current subscription plan" is a data object with planName, status.
"button" is a part of the screen (interactive).
"billing details" is a data object.
"Stripe" is an outside service.
"see" shows "current subscription plan".
"click" lets the person act on "button".
"manage" changes "billing details", "Stripe".
"safely" needs auth-session-check: Refuse the action unless the person has a valid signed-in session, checked on the server.
"safely" needs server-only-secret: Keep the API key or secret on the server; it must never reach the browser bundle.
"safely" needs validated-redirect: Redirect only to an allow-listed address, so a crafted link cannot send the person elsewhere.
```

## How the parser reads a sentence

1. Sentences split at `.`, `!`, `?` and newlines; a comma ends a verb's reach. The controlled-English templates
   "When `<trigger>`, `<actor>` can `<verb>` `<noun>`", "`<actor>` needs to `<verb>` `<noun>`" and "`<actor>` can `<verb>`
   `<noun>` via `<external>`" are read as fixed marker words (when, needs/wants to, can, be able to, via) around the
   lexicon's words, which are stop words.
2. Each word is looked up: a noun phrase (up to three words, plurals folded, `current` and similar modifiers joined to the
   entity that follows, a state joined to the actor after it: "logged-in user"), an adjective, or a verb (inflections
   folded: sees, clicking, saved). A word that is both (`list`) is a verb only after "to", "can", "will", "must".
3. A verb acts on the nouns after it up to the next verb or comma; a noun standing directly before a verb belongs to that
   verb ("keyboard filtering"); a read or write verb with nothing after it acts on the nearest earlier data object
   ("see it update": both act on the picture). States are never targets.
4. Anything else is an open question. A word after "to", "can", "will", "must", "should", "may" is asked as a verb
   (read, write, interact, navigate, ignore); any other is asked as a noun (entity, state, ui-part, external, ignore).

`resolveOpen(card, { o1: 'entity' })` re-parses the text with the answer recorded on the card (`answers[]`), so the new
card is exactly what the lexicon would have produced. It never changes the card it was given, and an unknown question or
option is a typed error (`RESOLVE_UNKNOWN_OPEN`, `RESOLVE_UNKNOWN_OPTION`), never a throw. The open questions are
vocabulary choices, not plan flows, so they are not built with `defineChooser` (its options must be `PLAN_FLOWS` flows);
they share its summary shape, its 2-5 option limit and its typed-error rule, and `suggest(question)` from
`decision-provider.mjs` works on them unchanged.

## Also classified without a model (placed in `docs/PLACEMENT.md`, #641)

- "A user wants to upload a profile picture and see it update instantly." gives the entity `profile picture`, `upload`
  (interact), `see` (read), `update` (write) and the check `latency-budget` from "instantly".
- "A customer wants to search products with instant keyboard filtering." gives the entity `products`, the ui-part
  `keyboard`, `search` and `filtering` (read) and the check `latency-budget` from "instant".

## Lexicon

`requirement-lexicon.json` is data only, checked by `validateLexicon` (named `LEXICON_*` codes): stop words, the four verb
kinds, the four noun kinds, modifiers, the named checks (each with a `why`), the adjective-to-check map (every check must
exist) and the two open-question option sets. Adding a word is a data change, not a code change.

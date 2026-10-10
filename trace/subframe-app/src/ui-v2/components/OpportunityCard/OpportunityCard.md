# Opportunity Card — usage

An opportunity is a procurement move MAX has surfaced. The card's job is to say, at a glance, **what kind of value it carries** and **what it needs from the user right now**.

## `emphasis` — what the opportunity needs from you

This is a qualification state, not a decoration. Pick it from where the opportunity actually stands, never to draw attention.

`default` — qualified and in flight. Evidence is sufficient, the confidence score is meaningful, and work is progressing. The quiet majority of cards.

`critical` — qualified, but something has changed and the user must look. A signal has invalidated part of the case, a window is closing, or a decision has stalled past its date. Reserve the red border for genuine time-or-money consequence; if every card is critical, none is.

`unqualified` — only *potential*. Either the opportunity is speculative, or its confidence score is too low to act on, and MAX needs more information from the user before it can be qualified at all. This is why the card shows the "Answer questions" CTA and hides both the qualified-progress bar and the signals/actions footer: there is genuinely nothing to report yet, and showing an empty or near-zero score would read as a finding rather than an absence. The dashed border signals "not yet real" — it is the visual consequence of the state, not the reason for it.

Do not use `unqualified` for a *low but real* score. A qualified opportunity sitting at 40% is `default` with a 40% bar — that is a finding. `unqualified` means MAX cannot score it yet.

## `type` — what kind of value it carries

`savings` (cost), `esg` (sustainability), `resilience` (supply risk). One per card — pick the primary driver, the one that would still justify the move on its own. Secondary effects belong in the signal tags underneath, where they can also read negatively (a savings play that raises risk).

## Expansion is the parent's decision

`state` is a prop, not internal state. Only one card should be expanded in a list at a time, and the expanded card is expected to widen to the full row — its body is a two-column narrative/actions split that becomes unreadable at half width. A card that owned its own open state could not coordinate either behaviour.

## Labelling

- **Title** — the move, not the category. "Use hedging and forward cover to manage barley price volatility", not "Barley".
- **Status** (the text opposite the lens tab) — say what changed or what is owed, in the user's terms: "Impacted, needs review", "17 days left", "Needs your input". Not a status taxonomy like "OPEN" or "STAGE 2".
- **Impact level** — must agree with the impact label. "Medium Impact" with three filled bars misreads as high; keep `level` and the label in step.
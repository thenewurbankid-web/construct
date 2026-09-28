# The email composer's chat

Feature description: README.md, "Run summary" (the email composer). Code: `src/ai/mail-chat.mjs` (prompts, reply parsing, the fact check), `POST /api/mail-chat` in `src/server.mjs` (streams the model's reply as server-sent events).

Every rewrite is a proposal. It is checked against the email it came from and the request, and shown with the result of that check; nothing is applied unseen unless Auto-apply is on and the check is clean.

## Limits

The fact check is a set of patterns, not an understanding of the text. `factsOf` collects quoted names, dotted or slashed names, camelCase and snake_case names, ticket ids, HTTP verbs and endpoints, numbers, weekdays and months, and `checkDraft` flags any of those in the draft that was not in the email or the request.

What it does **not** catch:

- An invented plain-word name or claim: "the Billing team owns this", "Marketing agreed", "this was approved last week". No pattern matches those, so the draft counts as clean.
- A changed meaning built from facts that are all present: swapping which field goes with which endpoint, turning "blocker" into "nice to have", moving a deadline from one item to another.
- Dates and numbers written in words ("next Friday" is a weekday and is checked; "in two weeks" or "twelve" is not).
- Invented facts that only rephrase an existing one ("3 fields" versus "three fields").

So a clean check means "no new names, numbers, dates or endpoints", not "true". A person still reads the proposal before it is sent. The behaviour is unchanged; this note only records the limit.

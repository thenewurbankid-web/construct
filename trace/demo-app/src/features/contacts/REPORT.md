# line-matcher report: contacts

**Dynamic parts found:** 6 (2 page values, 4 list fields) · **Actions:** 4 · **Questions asked:** 4

## Matches

| Part | Design showed | Comes from |
|---|---|---|
| contactCount | 3 | count → asText |
| directoryUpdated | 26 Sep 2026 | placeholder getDirectoryUpdated() |
| row.fullName | Lena Kumar, Arjun Rao, Mia Shah | placeholder getFullName() |
| row.initials | LK, AR, MS | skipped — answer later |
| row.email | lena@example.com, arjun@example.com, mia@example.com | email → asText |
| row.city | Pune, Delhi, Mumbai | city → asText |
| row order | — | keep the API order |

## Actions

| Action | Where | Does |
|---|---|---|
| edit | row | select |
| delete | row | remove |
| save | page | save |
| cancel | page | clear |

## AI decisions to review

- **list.fullName** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: The Name column shows the contact's first name and last name together, separated by a space.
- **list.fullName#from** → provided by the controller — placeholder function in the controller
  ollama:qwen2.5-coder:1.5b: Initials are the first letter of the first name followed by the first letter of the last name, in capitals.
- **value.directoryUpdated** → something else — build a placeholder…
  ollama:qwen2.5-coder:1.5b: The header shows when the directory was last updated; the backend will add an endpoint for this later.
- **value.directoryUpdated#from** → provided by the controller — placeholder function in the controller
  ollama:qwen2.5-coder:1.5b: The header shows when the directory was last updated; the backend will add an endpoint for this later.

## Open items — what would close them

- **row.fullName** (placeholder) — getFullName() is a placeholder in the controller layer.
  → Write the real logic in getFullName(), or close it by data: If the API has it, add a field to the GET response with these values per row (id 1 → "Lena Kumar", id 2 → "Arjun Rao", id 3 → "Mia Shah"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **row.initials** (skipped) — No API field, with any built-in format, produces "LK", "AR", "MS".
  → If the API has it, add a field to the GET response with these values per row (id 1 → "LK", id 2 → "AR", id 3 → "MS"); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.
- **directoryUpdated** (placeholder) — getDirectoryUpdated() is a placeholder in the controller layer.
  → Write the real logic in getDirectoryUpdated(), or close it by data: If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.
- **call (row action)** (skipped) — "call" isn't a verb the tool knows (create, add, update, save, delete, remove, edit, select, cancel, reset, refresh).
  → Rename it in the design (data-action) to a known verb, or answer with your own placeholder handler.

## Skipped — answer later

- Row part "initials" (e.g. "LK") can't be produced from any API field. What is it?
- What should the "call" row action do?

## Placeholders to fill in

| Part | Function | Layer | Input |
|---|---|---|---|
| row.fullName | getFullName() | Controller | controller |
| directoryUpdated | getDirectoryUpdated() | Controller | controller |

## Layers (7)

- **Route** — the feature is reached at /contacts
- **Controller** — 3 data props and 4 actions must be wired to the page
- **Workflow** — states: loading/ready/failed/creating/updating/removing; events: EDIT, DELETE, SAVE, CANCEL
- **Service** — 4 API endpoints are called
- **Domain** — computed values (contactCount), turning form input into API types
- **Page** — the designed JSX, rewritten to take props
- **Component** — the repeated "contacts" row becomes ContactRow

## Questions & answers

- Row part "fullName" (e.g. "Lena Kumar") can't be produced from any API field. What is it?
  → placeholder getFullName(), provided by the controller
- Row part "initials" (e.g. "LK") can't be produced from any API field. What is it?
  → left open (auto mode) — answer later
- "directoryUpdated" (shows "26 Sep 2026") can't be computed from the mock data. What is it?
  → placeholder getDirectoryUpdated(), provided by the controller
- What should the "call" row action do?
  → left open (auto mode) — answer later

## Files

- features/contacts/route/ContactsRoute.jsx
- features/contacts/controller/ContactsController.jsx
- features/contacts/workflow/contacts.workflow.js
- features/contacts/service/contacts.service.js
- features/contacts/domain/contacts.domain.js
- features/contacts/domain/contacts.domain.test.js
- features/contacts/page/ContactsPage.jsx
- features/contacts/component/ContactRow.jsx
- features/contacts/mocks/contacts.mock.js

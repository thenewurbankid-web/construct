<!-- Draft sub-issue. Title: "[Demo] As a product owner I want to read and edit a workflow in plain English". Parent: the Cockpit guide. -->

# [Demo] As a product owner I want to read and edit a workflow in plain English

**As a** product owner or developer, **I want** a workflow (a state machine such as "refund
request" or "checkout") explained as sentences and step-by-step scenarios, and to edit it visually,
**so that** I can agree on the behaviour without reading code, and see the consequences of each
change immediately.

## CLI

Explain a feature's workflows in plain English, read-only, from the real source every time:

```
construct research workflow <feature> [<file>] [--format prose|md|json|scenarios] [--dir <path>]
```

Real run on the demo project (`construct research workflow shop CheckoutWorkflow.tsx --format prose`,
output complete):

```
== features/shop/workflows/CheckoutWorkflow.tsx ==

Checkout
The "checkout" flow has 3 steps. It starts in *idle* and can end in *done*.

What it remembers
  - It remembers quantity (a number), starting as 1.
  - It remembers error (text that can be empty), starting as empty.

Idle
  - This flow starts in *idle*.
  - When "submit" happens, the flow moves to *submitting*.

Submitting
  - When "success" happens, the flow moves to *done*.
  - When "failure" happens, the flow moves to *idle* — only if it has error.

Done
  - *done* is an end state — the flow stops there.

Scenarios
  Happy path
    Route: idle → submitting → done
    Given the flow starts in *idle*
    When "submit" happens
    Then the flow moves to *submitting*
    And when "success" happens
    Then the flow moves to *done*
    And the flow ends — *done* is an end state
    Note: from *submitting* the flow can go back to *idle* when "failure" happens (only if it has error), so this part can repeat.

Health
  - [no-fallback] In *submitting*, "failure" only applies under a condition (it has error) and there is no fallback, so if none holds, nothing happens.

Explained 1 machine(s) in 1 file(s) (0.03s)
[tool: produced the read-only report above] [llm: 0 calls]
```

Other formats: `md` for documents, `json` for tools, `scenarios` for just the start-to-end paths.
Editing a workflow from the command line is done by regenerating it (`construct create workflow
<name> --feature <f> --from <spec.json>`); there is no CLI command that edits an existing machine.

## UI

1. Open the **Workflows** screen (Browser pane, **Screens** tab, or `Ctrl K` then "Go to
   Workflows"). Pick a feature and a workflow file.
2. The stage shows the diagram (drag to pan, scroll to zoom, the corner buttons fit it to the
   window). In the Tools panel, the **Narrative** tab reads the flow out in plain English, lists
   every start-to-end scenario, and ends with a **Health** section for structural problems.
3. Open the **Edit** tab to add a state or a transition, then **Confirm save**. Every edit is
   previewed as a diff first and only then written to the real file.
4. Go back to **Narrative**: the sentences, scenarios and health list have already changed. Adding
   a state `refunded` with no way in or out produces "There is no way out of refunded" and two
   Health findings (unreachable, dead end).
5. **Context & actions** lets you edit what the flow remembers and which actions and conditions
   run, with the same preview-then-confirm step.

![Narrative of a refund flow: 8 steps, sentences per step and the scenarios](https://raw.githubusercontent.com/thenewurbankid-web/construct/ui-screenshots/ui/e2e/screenshots/demos/cockpit-5-workflow-narrative.png)

![After adding a "refunded" state: the English and Health follow at once](https://raw.githubusercontent.com/thenewurbankid-web/construct/ui-screenshots/ui/e2e/screenshots/demos/cockpit-6-workflow-edit-health.png)

## What you'll see

For the refund flow: "The refund request flow has 8 steps", per-step sentences such as "After 48
hours, the flow moves to escalated", and a happy-path scenario. After the edit on the checkout
flow, a new "Refunded" block and Health findings "refunded can never be reached" and "refunded is
a dead end".

## Benefit

- **Who benefits:** product owners, testers and developers agreeing on a flow.
- **What problem it removes:** a state machine only its author can read, and edits whose effects
  (a stuck or unreachable state) are found later in testing.
- **Evidence:** the refund flow (8 steps, 13 transitions) is explained with 9 scenarios from one
  file; adding one disconnected state raised exactly 2 health findings immediately (asserted in
  the demo). The CLI run above reports `llm: 0 calls` and took 0.03s. Runs:
  `cockpit-workflows.spec.js` (5a, 5b).

Verified on `9ed0948` (2026-09-19) against `main`.

# Design principles: the production Cockpit

The Cockpit is a cockpit, not an autopilot: a person watches, understands and
steers deterministic machinery (and, at the edges, models). These principles
turn that into concrete rules.

1. **Calm.** Neutral surfaces, one accent, colour only for meaning (status,
   layer, deterministic vs model). No decorative blur or gradients on working
   surfaces; motion only to explain a change (a process starting, a diff
   arriving) and never when the user prefers reduced motion. Today's glass
   panels are retired for the shell (see tokens.md).
2. **Dense but legible.** Professional tools show a lot. Default row height 26px,
   base text 13px, 11px only for labels/metadata; body text never below 12px.
   Density is a setting later; the default is compact.
3. **Keyboard-first.** Every action has a keyboard path; Ctrl K opens the
   command palette (every palette command runs the same block as the CLI);
   `/` filters the browser; Ctrl J toggles the drawer; Ctrl 1/2/3 switch mode;
   panes are reachable with F6. Shortcuts are listed under `?`.
4. **Accessible (WCAG 2.2 AA).** Text contrast 4.5:1 (3:1 for large text and UI
   boundaries), visible 2px focus ring in `--focus` on every control, targets at
   least 24x24 px, no information by colour alone (status also has text/icon),
   landmarks for the three panes, `role=tablist/tab` semantics on tabs,
   resizers are focusable and operable with arrow keys, live regions for
   process status changes.
5. **Dark and light at parity.** Both themes are designed, not inverted; every
   mock is reviewed in both; default follows the OS, with a manual override.
6. **Plain language for stakeholders.** Say what happened, not how it is
   implemented: "Page imports a hook; go through a controller" beats a rule id
   alone (show both). Layer names (page, component, workflow...) are real
   product vocabulary and stay; internal function names do not.
7. **Progressive disclosure.** Default view answers "what is this and is it
   OK"; detail is one click away (Inspector, then Source, then Diff). Advanced
   controls (rewire an event, edit a plan) appear in context, not in permanent
   toolbars.
8. **Show provenance.** Always distinguish Deterministic (computed by a block),
   Local model (small scoped LLM step) and You (needs approval). Nothing a
   model produced is applied without a visible diff.
9. **Recoverable and honest.** Empty, loading and error states are designed
   screens (with a next action), not blank space. Errors say what happened and
   the fix. Long work is a Process: visible, pausable, cancellable.
10. **Modular by construction.** Panes, tabs and drawer tabs are slots that
    features register into (small interface: id, title, badge, render). A
    feature never reaches into another feature's panel.

## Review checklist (used by design reviews and implementation sign-off)

- [ ] Contrast measured for text, icons, focus ring, in dark and light
- [ ] Complete keyboard path; focus order matches visual order; focus visible
- [ ] Targets >= 24px; no hover-only functionality
- [ ] Status not conveyed by colour alone
- [ ] Reduced-motion respected; no flashing
- [ ] Empty, loading, error and offline-model states exist
- [ ] Works at 1280 px wide, 900 px (collapsed right pane), 390 px (one pane)
- [ ] Uses only tokens from tokens.md; no new raw colours
- [ ] Provenance (deterministic / model / you) is visible where it matters
- [ ] Copy is plain language, consistent with existing terms

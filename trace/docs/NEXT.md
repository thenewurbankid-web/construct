# Coming next

<!--
Planned releases (minor releases), soonest first, one top-level bullet each, optionally followed by indented
sub-bullets listing the concrete changes:
`- <planned id> [building|planned] — <what the owner will be able to do> (<Paperclip task>, ETA <date-or-text>)`
`  - <a concrete change>`
The `[status]` marker sits right after the id, before the dash, and is optional — an old one-line entry with
neither a marker nor sub-bullets still parses (default status "planned", no changes listed). At most one item in
the file should be `[building]` at a time (what's actually being worked on now); everything else is `[planned]`.
Planned ids are a forecast: the real id is taken from RELEASE at release time. When a block ships, remove its
bullet here (it is in CHANGELOG.md now) and add the next planned one at the bottom. Read by src/changelog.mjs's
parseNext() and shown on the Changelog page above the release history; an empty file shows "Nothing planned yet".
-->

- R6.71 [planned] — the States & flows tab shows the field a state's condition resolves to (LIN-258 follow-up, ETA 2026-10-06)
  - a state row that resolves a `field` shows which contract field drives it, next to its requirement text
  - a state with no resolved field reads the same as today (no regression to the existing tab)

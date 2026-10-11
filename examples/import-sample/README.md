# import-sample

A small plain React + TypeScript app that was not built with Line, used by Line's Import flow (step ci1) and its
tests. It is shaped like the max-ai-ui Alerts inbox: an app shell and shared UI outside the folder, and one folder,
`src/alerts`, to bring into Line. Nothing here carries a Line marker yet.

- `src/App.tsx` routes `/alerts` and `/alerts/:id` (outside the folder: Import never changes it).
- `src/ui/Card.tsx` is the app's shared UI (outside the folder).
- `src/alerts/` is the folder to import: two pages, three components, a hook, a fixture and a types file.

What Import proposes for `src/alerts`:

- SeverityBadge and useAlerts go to the library: both pages use them. The fixture goes with useAlerts.
- AlertRow goes to feature `alerts`: only the alerts list uses it.
- Table is the one question: its name is general UI (library), but only the alerts list uses it (feature).
- The two pages go to feature `alerts`, served at `/alerts` and `/alerts/:id`.
- `types.ts` holds only types, so it stays where it is.

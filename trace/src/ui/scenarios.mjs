// The three curated scenarios of the demo. Shared by the demo shell (cards), the server (which fix may be applied)
// and the preflight (what must exist). example is the folder under examples/.
// expect: what a run with every Ask skipped gives on a clean example (docs/DEMO.md quotes these; demo:check fails if they drift).
export const SCENARIOS = [
  {
    id: "portfolio",
    example: "portfolio-redesigned",
    title: "Portfolio Health",
    tag: "A real page",
    expect: { total: 29, fit: 8 },
    caption: "A real page against the Category Health contract. Finds genuine mismatches, like a 1 to 5 score against a 0 to 100 one.",
  },
  {
    id: "invoices",
    example: "invoices",
    title: "Invoices",
    tag: "Lots of Asks",
    expect: { total: 19, fit: 13 },
    caption: "Six Asks on one screen: two fields that look the same, a missing status and a button nobody defined.",
  },
  {
    id: "orders",
    example: "orders",
    title: "Orders",
    tag: "Fix, then Replay",
    expect: { total: 15, fit: 11 },
    caption: "The API is behind the design. Ship the fix, press Replay, and every Gap closes at once.",
    fix: "fixed.openapi.json", // copied over openapi.json by "Backend ships the fix"; Reset demo restores the original
  },
];
export const scenarioById = (id) => SCENARIOS.find((s) => s.id === id);

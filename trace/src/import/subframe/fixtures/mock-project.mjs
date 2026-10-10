// A RECORDED FIXTURE of the shape Subframe's MCP tools (list_projects / list_pages / list_components) return —
// not a live response. It exists so the project/page/component picker (T13.2) has a real shape to render and test
// against while the live connection is blocked (see ../mcp-client.mjs). No code in this repo may present this as a
// live result: every consumer must show it behind the "not connected" state and label it a fixture (see
// src/ui/import-wizard.mjs, subframeStepHtml).
//
// Shape recorded from Subframe's own docs (list_projects/list_pages/list_components tool descriptions) plugin
// tool ids `mcp__plugin_subframe_subframe__{list_projects,list_pages,list_components}`; the field names below
// mirror those tools' documented output, not a guess.
export const MOCK_SUBFRAME_PROJECT = {
  _fixture: true,
  _note: "Recorded shape only; not live Subframe data. The live MCP connection is blocked by OAuth 2.1 (see ../mcp-client.mjs).",
  project: { id: "proj_demo", name: "Portfolio Health (demo)" },
  pages: [
    {
      id: "page_portfolio_health",
      name: "Portfolio Health",
      components: [
        { id: "cmp_kpi_row", name: "KpiRow" },
        { id: "cmp_holdings_table", name: "HoldingsTable" },
        { id: "cmp_rebalance_action", name: "RebalanceButton" },
      ],
    },
    {
      id: "page_invoices",
      name: "Invoices",
      components: [
        { id: "cmp_invoice_table", name: "InvoiceTable" },
        { id: "cmp_invoice_status", name: "StatusBadge" },
      ],
    },
  ],
};

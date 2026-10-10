// Designed page (static, as exported from the design tool).
// Mark the dynamic parts:  data-dyn="name"  ·  data-list="name"  ·  data-action="verb"
export default function DesignedPage() {
  return (
    <main className="page">
      <header className="header">
        <h1>Invoices</h1>
        <p className="meta">
          <span data-dyn="invoiceCount">3</span>
          {" invoices · billed "}
          <span data-dyn="totalBilled">$276.0M</span>
          {" · outstanding (all time) "}
          <span data-dyn="outstandingTotal">$487.3M</span>
        </p>
      </header>
    </main>
  );
}

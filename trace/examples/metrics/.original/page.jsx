// Designed page (static, as exported from the design tool).
// Mark the dynamic parts:  data-dyn="name"  ·  data-list="name"  ·  data-action="verb"
export default function DesignedPage() {
  return (
    <main className="page">
      <header className="header">
        <h1>Metrics</h1>
        <p className="meta">
          <span data-dyn="regionCount">4</span>
          {" regions · revenue "}
          <span data-dyn="totalRevenue">$364.0M</span>
          {" · best region "}
          <span data-dyn="bestRevenue">$120.0M</span>
          {" · lowest cost "}
          <span data-dyn="lowestCost">$33.0M</span>
          {" · conversion "}
          <span data-dyn="avgConversion">18.5%</span>
          {" · as of "}
          <span data-dyn="asOf">26 Sep 2026</span>
        </p>
      </header>
    </main>
  );
}

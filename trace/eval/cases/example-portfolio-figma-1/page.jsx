// Portfolio Health — Figma rebuild (Subframe page 4bfd1c16-9d2a-4223-b709-ba46c6ead88c).
// Marked for line-matcher: data-dyn = data, data-list = repeated rows, data-action = a button.
export default function DesignedPage() {
  return (
    <main className="page">
      <nav className="crumbs">Health / My Portfolio</nav>
      <header className="header">
        <h1>My Portfolio</h1>
        <p className="meta">
          {"Your categories "}<span data-dyn="categoryCount">6</span>
          {" · Spend you manage "}<span data-dyn="spendYouManage">$280.2M</span>
          {" · Refreshed "}<span data-dyn="refreshedAt">31 Jul 2026</span>
        </p>
      </header>

      <section className="card">
        <p className="kicker">MAX · Your portfolio summary</p>
        <h2><span data-dyn="headline">Grains is carrying your portfolio. Logistics and Packaging are not.</span></h2>
        <p>{"Improving: "}<span data-dyn="improving">Grains, up on contract coverage and a renegotiated origination mix, and Chemicals, where the solvent index fell two quarters running.</span></p>
        <p>{"Declining: "}<span data-dyn="declining">Logistics, where the maturity gap widened to -0.7 and three high flags are open, and Packaging, where supplier concentration moved the wrong way. IT & Software is flat.</span></p>
      </section>

      <h2>Your portfolio at a glance</h2>
      <div className="cards">
        <div className="card metric">
          <p className="label">Spend you manage · T12M</p>
          <p className="big"><span data-dyn="spendCard">$280M</span></p>
          <p><span data-dyn="spendYoy">▲ 8.4% YoY</span></p>
          <p className="note">{"Across the six categories assigned to you. "}<span data-dyn="largestName">Grains & Cereals</span>{" is "}<span data-dyn="largestShare">33%</span>{" of it."}</p>
        </div>
        <div className="card metric">
          <p className="label">Savings potential</p>
          <p className="big"><span data-dyn="savingsCard">$24.5M</span></p>
          <p><span data-dyn="acceptedPct">38%</span>{" of qualified savings initiatives accepted"}</p>
          <p className="note">{"Sum of the mid-point estimate from each of your six categories. "}<span data-dyn="acceptedCount">23 of 60</span>{" qualified initiatives have been accepted."}</p>
        </div>
        <div className="card metric">
          <p className="label">Resilience based initiatives</p>
          <p className="big"><span data-dyn="resilienceTotal">21</span></p>
          <p><span data-dyn="impactHigh">7</span>{" high · "}<span data-dyn="impactMedium">13</span>{" medium · "}<span data-dyn="impactLow">1</span>{" low."}</p>
          <p className="note"><span data-dyn="highCategories">4</span>{" categories carry at least one high."}</p>
        </div>
        <div className="card metric">
          <p className="label">Number of savings initiatives</p>
          <p className="big"><span data-dyn="savingsCount">26</span></p>
          <p>{"target "}<span data-dyn="savingsTarget">$42.0M</span></p>
          <p className="note">{"Savings initiatives raised but not yet accepted by an owner. Oldest has been waiting "}<span data-dyn="oldestDays">34</span>{" days."}</p>
        </div>
        <div className="card metric">
          <p className="label">Risk initiatives</p>
          <p className="big"><span data-dyn="riskCount">6</span></p>
          <p>{"resilience initiatives · "}<span data-dyn="riskCategories">2</span>{" categories"}</p>
          <p className="note">{"target "}<span data-dyn="riskTarget">8.0</span></p>
        </div>
      </div>

      <div className="card">
        <p>Ask Anything about your portfolio</p>
        <button data-action="suggest">Prompt suggestion 01</button>
        <button data-action="suggest">Prompt suggestion 02</button>
      </div>

      <h2>Category overview</h2>
      <p className="meta">Order based on top spend categories (Top 10) within that ordered by the ones needing max attention. Open any row for the full scorecard.</p>
      <table className="card table">
        <thead>
          <tr>
            <th>#</th><th>Category</th><th>Spend</th><th>Maturity</th><th>Savings potential</th><th>Needs attention</th><th>Trend</th><th></th>
          </tr>
        </thead>
        <tbody data-list="categories">
          <tr>
            <td><span data-dyn="rank">01</span></td>
            <td><span data-dyn="name">Logistics</span> <span data-dyn="level" className="badge">L3</span></td>
            <td className="num"><span data-dyn="spend">$38.4M</span> <span data-dyn="share">13.7%</span></td>
            <td><span data-dyn="maturity">2.0</span> <span data-dyn="maturityGap">-0.7</span> <span data-dyn="peer">peer 2.7</span></td>
            <td className="num"><span data-dyn="savings">$5.6M</span> <span data-dyn="savingsPct">14.6%</span></td>
            <td><span data-dyn="flagFirst" className="badge err">3 high flags</span> <span data-dyn="flagSecond" className="badge err">widest maturity gap</span></td>
            <td><svg width="64" height="20" viewBox="0 0 64 20"><path d="m2 6 12 2 12-1 12 5 12 2 12 4" fill="none" stroke="currentColor" /></svg></td>
            <td className="actions"><button data-action="open">Open</button></td>
          </tr>
          <tr>
            <td><span data-dyn="rank">02</span></td>
            <td><span data-dyn="name">Packaging</span> <span data-dyn="level" className="badge">L2</span></td>
            <td className="num"><span data-dyn="spend">$62.8M</span> <span data-dyn="share">22.4%</span></td>
            <td><span data-dyn="maturity">1.8</span> <span data-dyn="maturityGap">-0.6</span> <span data-dyn="peer">peer 2.4</span></td>
            <td className="num"><span data-dyn="savings">$7.1M</span> <span data-dyn="savingsPct">11.3%</span></td>
            <td><span data-dyn="flagFirst" className="badge err">largest unclaimed $7.1M</span> <span data-dyn="flagSecond" className="badge err">2 high flags</span></td>
            <td><svg width="64" height="20" viewBox="0 0 64 20"><path d="m2 6 12 2 12-1 12 5 12 2 12 4" fill="none" stroke="currentColor" /></svg></td>
            <td className="actions"><button data-action="open">Open</button></td>
          </tr>
          <tr>
            <td><span data-dyn="rank">03</span></td>
            <td><span data-dyn="name">IT Services</span> <span data-dyn="level" className="badge">L3</span></td>
            <td className="num"><span data-dyn="spend">$45.2M</span> <span data-dyn="share">16.1%</span></td>
            <td><span data-dyn="maturity">2.1</span> <span data-dyn="maturityGap">-0.5</span> <span data-dyn="peer">peer 2.6</span></td>
            <td className="num"><span data-dyn="savings">$4.2M</span> <span data-dyn="savingsPct">9.3%</span></td>
            <td><span data-dyn="flagFirst" className="badge err">single supplier 9.5%</span> <span data-dyn="flagSecond" className="badge err">$410K past due</span></td>
            <td><svg width="64" height="20" viewBox="0 0 64 20"><path d="m2 6 12 2 12-1 12 5 12 2 12 4" fill="none" stroke="currentColor" /></svg></td>
            <td className="actions"><button data-action="open">Open</button></td>
          </tr>
          <tr>
            <td><span data-dyn="rank">04</span></td>
            <td><span data-dyn="name">Professional Services</span> <span data-dyn="level" className="badge">L2</span></td>
            <td className="num"><span data-dyn="spend">$27.3M</span> <span data-dyn="share">9.7%</span></td>
            <td><span data-dyn="maturity">2.3</span> <span data-dyn="maturityGap">-0.2</span> <span data-dyn="peer">peer 2.5</span></td>
            <td className="num"><span data-dyn="savings">$2.9M</span> <span data-dyn="savingsPct">10.6%</span></td>
            <td><span data-dyn="flagFirst" className="badge err">1 high flag</span> <span data-dyn="flagSecond" className="badge">rate card 14% over peers</span></td>
            <td><svg width="64" height="20" viewBox="0 0 64 20"><path d="m2 6 12 2 12-1 12 5 12 2 12 4" fill="none" stroke="currentColor" /></svg></td>
            <td className="actions"><button data-action="open">Open</button></td>
          </tr>
          <tr>
            <td><span data-dyn="rank">05</span></td>
            <td><span data-dyn="name">MRO</span> <span data-dyn="level" className="badge">L2</span></td>
            <td className="num"><span data-dyn="spend">$14.9M</span> <span data-dyn="share">5.3%</span></td>
            <td><span data-dyn="maturity">2.2</span> <span data-dyn="maturityGap">-0.1</span> <span data-dyn="peer">peer 2.3</span></td>
            <td className="num"><span data-dyn="savings">$1.4M</span> <span data-dyn="savingsPct">9.4%</span></td>
            <td><span data-dyn="flagFirst" className="badge">maturity in line with peers</span> <span data-dyn="flagSecond" className="badge">tail spend 31% off-contract</span></td>
            <td><svg width="64" height="20" viewBox="0 0 64 20"><path d="m2 6 12 2 12-1 12 5 12 2 12 4" fill="none" stroke="currentColor" /></svg></td>
            <td className="actions"><button data-action="open">Open</button></td>
          </tr>
          <tr>
            <td><span data-dyn="rank">06</span></td>
            <td><span data-dyn="name">Grains &amp; Cereals</span> <span data-dyn="level" className="badge">L2</span></td>
            <td className="num"><span data-dyn="spend">$91.6M</span> <span data-dyn="share">32.7%</span></td>
            <td><span data-dyn="maturity">2.9</span> <span data-dyn="maturityGap">+0.3</span> <span data-dyn="peer">peer 2.6</span></td>
            <td className="num"><span data-dyn="savings">$3.2M</span> <span data-dyn="savingsPct">3.5%</span></td>
            <td><span data-dyn="flagFirst" className="badge ok">ahead on maturity</span> <span data-dyn="flagSecond" className="badge">largest category</span></td>
            <td><svg width="64" height="20" viewBox="0 0 64 20"><path d="m2 6 12 2 12-1 12 5 12 2 12 4" fill="none" stroke="currentColor" /></svg></td>
            <td className="actions"><button data-action="open">Open</button></td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}

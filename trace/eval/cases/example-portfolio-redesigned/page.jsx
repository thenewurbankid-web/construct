// Redesigned portfolio health (Subframe page a652d09f-ac57-4603-95cf-c9efa67d2f0a).
// Marked for line-matcher: data-dyn = data, data-list = repeated rows, data-action = a button.
export default function DesignedPage() {
  return (
    <main className="page">
      <header className="header">
        <h1>Portfolio health</h1>
        <p className="meta">
          {"Max · your portfolio summary · "}<span data-dyn="refreshedAt">31 Jul 2026</span>
        </p>
      </header>

      <section className="card">
        <h2><span data-dyn="headline">Grains is carrying your portfolio. Logistics and Packaging are not.</span></h2>
        <p>{"Improving: "}<span data-dyn="improving">Grains, up on contract coverage and a renegotiated origination mix, and Chemicals, where the solvent index fell two quarters running.</span></p>
        <p>{"Declining: "}<span data-dyn="declining">Logistics, where the maturity gap widened to −0.7 and three high flags are open, and Packaging, where supplier concentration moved the wrong way. IT & Software is flat.</span></p>
        <button data-action="suggest">Who could take 20% of this volume?</button>
        <button data-action="suggest">What am I missing?</button>
      </section>

      <h2>Your portfolio at a glance</h2>
      <div className="cards">
        <div className="card metric">
          <p className="label">Baseline spend</p>
          <p className="big"><span data-dyn="baselineSpend">$280M</span></p>
          <p className="note"><span data-dyn="highCategories">4</span>{" categories carry at least one high."}</p>
          <p className="note">{"Jan 2020 - Mar 2020 · As of 14 Mar, 09:00"}</p>
        </div>
        <div className="card metric">
          <p className="label">Potential savings</p>
          <p className="big"><span data-dyn="savingsRange">$42 - 68M</span></p>
          <p className="note">{"Identified across "}<span data-dyn="qualifiedCount">25</span>{" qualified opportunities"}</p>
        </div>
        <div className="card metric">
          <p className="label">Categories covered</p>
          <p className="big"><span data-dyn="coveredCount">21</span></p>
          <p className="note">Risk reduction awaiting a decision. Not measured in savings, so it is counted separately.</p>
        </div>
        <div className="card metric">
          <p className="label">Resilience initiatives</p>
          <p className="big"><span data-dyn="resilienceTotal">21</span></p>
          <p className="note">High · Medium · Low</p>
        </div>
        <div className="card metric">
          <p className="label">Savings initiatives</p>
          <p className="big"><span data-dyn="savingsCount">26</span></p>
          <p className="note">{"Savings initiatives raised but not yet accepted by an owner. Oldest has been waiting "}<span data-dyn="oldestDays">34</span>{" days."}</p>
        </div>
        <div className="card metric">
          <p className="label">Qualified initiatives</p>
          <p className="big"><span data-dyn="qualifiedInitiatives">16</span></p>
          <p className="note">Accepted · Pending</p>
        </div>
      </div>

      <h2>Category overview</h2>
      <p className="meta">Order based on top spend categories (Top 10) within that ordered by the ones needing max attention).</p>
      <table className="card table">
        <thead>
          <tr>
            <th>#</th><th>Category</th><th>Spend</th><th>Maturity</th><th>Potential savings</th><th>Composite risk score</th><th>Spend change</th><th></th>
          </tr>
        </thead>
        <tbody data-list="categories">
          <tr>
            <td><span data-dyn="rank">01</span></td>
            <td><span data-dyn="name">Logistics</span> <span data-dyn="level" className="badge">L2</span> <span data-dyn="shareLabel" className="badge">37% of total spend</span> <span data-dyn="oppLabel" className="badge">5 qualified opportunities</span> <span data-dyn="acceptedLabel" className="badge">5 accepted</span></td>
            <td className="num"><span data-dyn="spend">$78.4M</span></td>
            <td><span data-dyn="maturity">2.0</span> <span data-dyn="peer">peer 2.7</span></td>
            <td className="num"><span data-dyn="savingsRangeRow">$4.7M - $5.6M</span></td>
            <td className="num"><span data-dyn="risk">72</span></td>
            <td className="num"><span data-dyn="spendChange">+$5.1M</span></td>
            <td className="actions"><button data-action="open">Open</button></td>
          </tr>
          <tr>
            <td><span data-dyn="rank">02</span></td>
            <td><span data-dyn="name">Packaging</span> <span data-dyn="level" className="badge">L2</span> <span data-dyn="shareLabel" className="badge">22.4% of total spend</span> <span data-dyn="oppLabel" className="badge">3 qualified opportunities</span> <span data-dyn="acceptedLabel" className="badge">2 accepted</span></td>
            <td className="num"><span data-dyn="spend">$62.8M</span></td>
            <td><span data-dyn="maturity">1.8</span> <span data-dyn="peer">peer 2.4</span></td>
            <td className="num"><span data-dyn="savingsRangeRow">$5.3M - $7.1M</span></td>
            <td className="num"><span data-dyn="risk">69</span></td>
            <td className="num"><span data-dyn="spendChange">-$3.2M</span></td>
            <td className="actions"><button data-action="open">Open</button></td>
          </tr>
          <tr>
            <td><span data-dyn="rank">03</span></td>
            <td><span data-dyn="name">IT Services</span> <span data-dyn="level" className="badge">L2</span> <span data-dyn="shareLabel" className="badge">21.4% of total spend</span> <span data-dyn="oppLabel" className="badge">3 qualified opportunities</span> <span data-dyn="acceptedLabel" className="badge">2 accepted</span></td>
            <td className="num"><span data-dyn="spend">$45.2M</span></td>
            <td><span data-dyn="maturity">2.1</span> <span data-dyn="peer">peer 2.6</span></td>
            <td className="num"><span data-dyn="savingsRangeRow">$3.5M - $4.2M</span></td>
            <td className="num"><span data-dyn="risk">67</span></td>
            <td className="num"><span data-dyn="spendChange">+$1.2M</span></td>
            <td className="actions"><button data-action="open">Open</button></td>
          </tr>
          <tr>
            <td><span data-dyn="rank">04</span></td>
            <td><span data-dyn="name">Professional Services</span> <span data-dyn="level" className="badge">L2</span> <span data-dyn="shareLabel" className="badge">22.4% of total spend</span> <span data-dyn="oppLabel" className="badge">3 qualified opportunities</span> <span data-dyn="acceptedLabel" className="badge">2 accepted</span></td>
            <td className="num"><span data-dyn="spend">$27.3M</span></td>
            <td><span data-dyn="maturity">2.3</span> <span data-dyn="peer">peer 2.5</span></td>
            <td className="num"><span data-dyn="savingsRangeRow">$1.8M - $2.9M</span></td>
            <td className="num"><span data-dyn="risk">59</span></td>
            <td className="num"><span data-dyn="spendChange">$0.0</span></td>
            <td className="actions"><button data-action="open">Open</button></td>
          </tr>
          <tr>
            <td><span data-dyn="rank">05</span></td>
            <td><span data-dyn="name">MRO</span> <span data-dyn="level" className="badge">L2</span> <span data-dyn="shareLabel" className="badge">22.4% of total spend</span> <span data-dyn="oppLabel" className="badge">3 qualified opportunities</span> <span data-dyn="acceptedLabel" className="badge">2 accepted</span></td>
            <td className="num"><span data-dyn="spend">$14.9M</span></td>
            <td><span data-dyn="maturity">2.2</span> <span data-dyn="peer">peer 2.3</span></td>
            <td className="num"><span data-dyn="savingsRangeRow">$0.8M - $1.4M</span></td>
            <td className="num"><span data-dyn="risk">84</span></td>
            <td className="num"><span data-dyn="spendChange">+$5.1M</span></td>
            <td className="actions"><button data-action="open">Open</button></td>
          </tr>
          <tr>
            <td><span data-dyn="rank">06</span></td>
            <td><span data-dyn="name">Grains &amp; Cereals</span> <span data-dyn="level" className="badge">L2</span> <span data-dyn="shareLabel" className="badge">22.4% of total spend</span> <span data-dyn="oppLabel" className="badge">3 qualified opportunities</span> <span data-dyn="acceptedLabel" className="badge">2 accepted</span></td>
            <td className="num"><span data-dyn="spend">$11.6M</span></td>
            <td><span data-dyn="maturity">2.9</span> <span data-dyn="peer">peer 2.6</span></td>
            <td className="num"><span data-dyn="savingsRangeRow">$3.2M</span></td>
            <td className="num"><span data-dyn="risk">72</span></td>
            <td className="num"><span data-dyn="spendChange">-$5.1M</span></td>
            <td className="actions"><button data-action="open">Open</button></td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}

// Designed page (static, as exported from the design tool).
// Mark the dynamic parts:  data-dyn="name"  ·  data-list="name"  ·  data-action="verb"
export default function DesignedPage() {
  return (
    <main className="page">
      <header className="header">
        <h1>Deals</h1>
        <p className="meta">
          <span data-dyn="dealCount">6</span>
          {" deals · pipeline "}
          <span data-dyn="pipeline">$453.1M</span>
          {" · average deal "}
          <span data-dyn="avgDeal">$75.5M</span>
          {" · largest "}
          <span data-dyn="largest">$152.5M</span>
          {" · smallest "}
          <span data-dyn="smallest">$9.8M</span>
          {" · average margin "}
          <span data-dyn="avgMargin">28.8%</span>
          {" · weighted pipeline "}
          <span data-dyn="weighted">$137.6M</span>
          {" · synced "}
          <span data-dyn="syncedAt">26 Sep 2026</span>
        </p>
      </header>

      <form className="card form" data-action="save">
        <input name="name" placeholder="Deal" required />
        <input name="account" placeholder="Account" required />
        <input name="value" type="number" placeholder="Value (USD)" required />
        <input name="margin" type="number" step="0.01" placeholder="Margin (0-1)" required />
        <input name="notes" placeholder="Notes" />
        <button type="submit" className="primary">Save</button>
        <button type="button" data-action="cancel">Cancel</button>
      </form>

      <table className="card table">
        <thead>
          <tr>
            <th>Deal</th>
            <th>Account</th>
            <th>Contact</th>
            <th>Owner</th>
            <th>CSM</th>
            <th>Value</th>
            <th>Margin</th>
            <th>Close</th>
            <th>Stage</th>
            <th></th>
          </tr>
        </thead>
        <tbody data-list="deals">
          <tr>
            <td data-dyn="name">Borealis Expansion</td>
            <td data-dyn="account">Kestrel</td>
            <td data-dyn="contact">Arjun Rao</td>
            <td data-dyn="owner">Mia</td>
            <td data-dyn="csm">Mia</td>
            <td data-dyn="value" className="num">$152.5M</td>
            <td data-dyn="margin" className="num">28.1%</td>
            <td data-dyn="closeOn">2 Oct 2026</td>
            <td data-dyn="stage">Proposal</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="forecast">Forecast</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="name">Ember Platform</td>
            <td data-dyn="account">Harbor</td>
            <td data-dyn="contact">Prerna Iyer</td>
            <td data-dyn="owner">Arjun</td>
            <td data-dyn="csm">Arjun</td>
            <td data-dyn="value" className="num">$118.0M</td>
            <td data-dyn="margin" className="num">36.0%</td>
            <td data-dyn="closeOn">5 Dec 2026</td>
            <td data-dyn="stage">Proposal</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="forecast">Forecast</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="name">Atlas Renewal</td>
            <td data-dyn="account">Northwind</td>
            <td data-dyn="contact">Lena Kumar</td>
            <td data-dyn="owner">Prerna</td>
            <td data-dyn="csm">Prerna</td>
            <td data-dyn="value" className="num">$84.0M</td>
            <td data-dyn="margin" className="num">32.5%</td>
            <td data-dyn="closeOn">14 Oct 2026</td>
            <td data-dyn="stage">Negotiation</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="forecast">Forecast</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="name">Delta Upgrade</td>
            <td data-dyn="account">Oriel</td>
            <td data-dyn="contact">Ravi Nair</td>
            <td data-dyn="owner">Lena</td>
            <td data-dyn="csm">Lena</td>
            <td data-dyn="value" className="num">$61.3M</td>
            <td data-dyn="margin" className="num">19.8%</td>
            <td data-dyn="closeOn">29 Oct 2026</td>
            <td data-dyn="stage">Negotiation</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="forecast">Forecast</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="name">Cirrus Pilot</td>
            <td data-dyn="account">Bluepeak</td>
            <td data-dyn="contact">Mia Shah</td>
            <td data-dyn="owner">Ravi</td>
            <td data-dyn="csm">Ravi</td>
            <td data-dyn="value" className="num">$27.5M</td>
            <td data-dyn="margin" className="num">41.2%</td>
            <td data-dyn="closeOn">20 Nov 2026</td>
            <td data-dyn="stage">Qualified</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="forecast">Forecast</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="name">Fjord Support</td>
            <td data-dyn="account">Vantage</td>
            <td data-dyn="contact">Kabir Sen</td>
            <td data-dyn="owner">Mia</td>
            <td data-dyn="csm">Mia</td>
            <td data-dyn="value" className="num">$9.8M</td>
            <td data-dyn="margin" className="num">15.0%</td>
            <td data-dyn="closeOn">3 Nov 2026</td>
            <td data-dyn="stage">Won</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="forecast">Forecast</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}

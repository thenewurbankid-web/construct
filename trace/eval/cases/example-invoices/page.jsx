// Designed page (static, as exported from the design tool).
// Built to make the matcher ask questions: an ambiguous field, an unmatched column,
// an ambiguous sort, an ambiguous aggregate, a missing value and an unknown action verb.
export default function DesignedPage() {
  return (
    <main className="page">
      <header className="header">
        <h1>Invoices</h1>
        <p className="meta">
          <span data-dyn="invoiceCount">4</span> invoices ·{" "}
          <span data-dyn="totalBilled">$107.9M</span> billed · largest{" "}
          <span data-dyn="largestInvoice">$48.2M</span> · synced{" "}
          <span data-dyn="syncedAt">26 Sep 2026</span>
        </p>
      </header>

      <form className="card form" data-action="save">
        <input name="vendor" placeholder="Vendor" required />
        <input name="amount" type="number" placeholder="Amount (USD)" required />
        <input name="requester" placeholder="Requested by" required />
        <button type="submit" className="primary">Save</button>
        <button type="button" data-action="cancel">Cancel</button>
      </form>

      <table className="card table">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Vendor</th>
            <th>Amount</th>
            <th>Due</th>
            <th>Requested by</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody data-list="invoices">
          <tr>
            <td data-dyn="number">INV-1042</td>
            <td data-dyn="vendor">Kestrel Packaging</td>
            <td data-dyn="amount" className="num">$48.2M</td>
            <td data-dyn="dueDate">2 Aug 2026</td>
            <td data-dyn="requestedBy">Lena</td>
            <td data-dyn="status">Overdue</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="archive">Archive</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="number">INV-1044</td>
            <td data-dyn="vendor">Oriel Chemicals</td>
            <td data-dyn="amount" className="num">$31.6M</td>
            <td data-dyn="dueDate">9 Aug 2026</td>
            <td data-dyn="requestedBy">Mia</td>
            <td data-dyn="status">Overdue</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="archive">Archive</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="number">INV-1041</td>
            <td data-dyn="vendor">Northwind Freight</td>
            <td data-dyn="amount" className="num">$18.4M</td>
            <td data-dyn="dueDate">21 Aug 2026</td>
            <td data-dyn="requestedBy">Prerna</td>
            <td data-dyn="status">Open</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="archive">Archive</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="number">INV-1043</td>
            <td data-dyn="vendor">Bluepeak IT</td>
            <td data-dyn="amount" className="num">$9.7M</td>
            <td data-dyn="dueDate">5 Sep 2026</td>
            <td data-dyn="requestedBy">Arjun</td>
            <td data-dyn="status">Partial</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="archive">Archive</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}

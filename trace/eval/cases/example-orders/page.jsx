// Designed page (static, as exported from the design tool).
// Mark the dynamic parts:  data-dyn="name"  ·  data-list="name"  ·  data-action="verb"
export default function DesignedPage() {
  return (
    <main className="page">
      <header className="header">
        <h1>Orders</h1>
        <p className="meta">
          <span data-dyn="orderCount">3</span>
          {" orders · total value "}
          <span data-dyn="totalValue">$10,660</span>
        </p>
      </header>

      <form className="card form" data-action="save">
        <input name="customer" placeholder="Customer" required />
        <input name="total" type="number" placeholder="Total" required />
        <input name="notes" placeholder="Notes" required />
        <button type="submit" className="primary">Save</button>
        <button type="button" data-action="cancel">Cancel</button>
      </form>

      <table className="card table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Total</th>
            <th>Placed</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody data-list="orders">
          <tr>
            <td data-dyn="number">ORD-201</td>
            <td data-dyn="customer">Northwind</td>
            <td data-dyn="total" className="num">$1,200</td>
            <td data-dyn="placedOn">1 Sep 2026</td>
            <td data-dyn="status">Shipped</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="number">ORD-202</td>
            <td data-dyn="customer">Kestrel</td>
            <td data-dyn="total" className="num">$560</td>
            <td data-dyn="placedOn">3 Sep 2026</td>
            <td data-dyn="status">Pending</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="number">ORD-203</td>
            <td data-dyn="customer">Bluepeak</td>
            <td data-dyn="total" className="num">$8,900</td>
            <td data-dyn="placedOn">7 Sep 2026</td>
            <td data-dyn="status">Shipped</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}

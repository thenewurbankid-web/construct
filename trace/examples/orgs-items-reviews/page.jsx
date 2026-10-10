// Designed page (static, as exported from the design tool).
// Mark the dynamic parts:  data-dyn="name"  ·  data-list="name"  ·  data-action="verb"
export default function DesignedPage() {
  return (
    <main className="page">
      <header className="header">
        <h1>Items</h1>
        <p className="meta">
          <span data-dyn="itemCount">3</span>
          {" items · total qty "}
          <span data-dyn="qtyTotal">69</span>
        </p>
      </header>

      <form className="card form" data-action="save">
        <input name="name" placeholder="Name" required />
        <input name="sku" placeholder="SKU" required />
        <input name="qty" type="number" placeholder="Qty" required />
        <button type="submit" className="primary">Save</button>
        <button type="button" data-action="cancel">Cancel</button>
      </form>

      <table className="card table">
        <thead>
          <tr>
            <th>Item</th>
            <th>SKU</th>
            <th>Qty</th>
            <th></th>
          </tr>
        </thead>
        <tbody data-list="items">
          <tr>
            <td data-dyn="name">Pallet Jack</td>
            <td data-dyn="sku">PJ-100</td>
            <td data-dyn="qty" className="num">6</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="name">Shrink Wrap</td>
            <td data-dyn="sku">SW-220</td>
            <td data-dyn="qty" className="num">48</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="name">Barcode Scanner</td>
            <td data-dyn="sku">BS-310</td>
            <td data-dyn="qty" className="num">15</td>
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

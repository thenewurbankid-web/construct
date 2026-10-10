// Designed page (static, as exported from the design tool).
// Mark the dynamic parts:  data-dyn="name"  ·  data-list="name"  ·  data-action="verb"
export default function DesignedPage() {
  return (
    <main className="page">
      <header className="header">
        <h1>Products</h1>
        <p className="meta">
          <span data-dyn="productCount">3</span>
          {" products · stock "}
          <span data-dyn="stockTotal">287</span>
          {" units · average price "}
          <span data-dyn="avgPrice">$4,050</span>
        </p>
      </header>

      <form className="card form" data-action="save">
        <input name="name" placeholder="Name" required />
        <input name="price" type="number" placeholder="Price" required />
        <input name="stock" type="number" placeholder="Stock" required />
        <button type="submit" className="primary">Save</button>
        <button type="button" data-action="cancel">Cancel</button>
      </form>

      <table className="card table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Price</th>
            <th>Stock</th>
            <th>Added</th>
            <th></th>
          </tr>
        </thead>
        <tbody data-list="products">
          <tr>
            <td data-dyn="name">Desk Lamp</td>
            <td data-dyn="price" className="num">$4,900</td>
            <td data-dyn="stock" className="num">12</td>
            <td data-dyn="addedOn">4 Jul 2026</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="name">Notebook</td>
            <td data-dyn="price" className="num">$450</td>
            <td data-dyn="stock" className="num">240</td>
            <td data-dyn="addedOn">18 Jun 2026</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="name">Backpack</td>
            <td data-dyn="price" className="num">$6,800</td>
            <td data-dyn="stock" className="num">35</td>
            <td data-dyn="addedOn">1 Aug 2026</td>
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

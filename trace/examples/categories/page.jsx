// Designed page (static, as exported from the design tool).
// Mark the dynamic parts:  data-dyn="name"  ·  data-list="name"  ·  data-action="verb"
export default function DesignedPage() {
  return (
    <main className="page">
      <header className="header">
        <h1>My categories</h1>
        <p className="meta">
          <span data-dyn="categoryCount">4</span> categories ·{" "}
          <span data-dyn="totalSpend">$278.0M</span> total spend · largest{" "}
          <span data-dyn="largestSpend">$91.6M</span> · refreshed{" "}
          <span data-dyn="refreshedAt">31 Jul 2026</span>
        </p>
      </header>

      <form className="card form" data-action="save">
        <input name="name" placeholder="Category name" required />
        <input name="spend" type="number" placeholder="Spend (USD)" required />
        <input name="owner" placeholder="Owner" required />
        <button type="submit" className="primary">Save</button>
        <button type="button" data-action="cancel">Cancel</button>
      </form>

      <table className="card table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Spend</th>
            <th>Owner</th>
            <th></th>
          </tr>
        </thead>
        <tbody data-list="categories">
          <tr>
            <td data-dyn="name">Grains &amp; Cereals</td>
            <td data-dyn="spend" className="num">$91.6M</td>
            <td data-dyn="owner">Lena</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="name">Logistics</td>
            <td data-dyn="spend" className="num">$78.4M</td>
            <td data-dyn="owner">Prerna</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="name">Packaging</td>
            <td data-dyn="spend" className="num">$62.8M</td>
            <td data-dyn="owner">Arjun</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="name">IT Services</td>
            <td data-dyn="spend" className="num">$45.2M</td>
            <td data-dyn="owner">Mia</td>
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

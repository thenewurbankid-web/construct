export default function DesignedPage() {
  return (
    <main className="page">
      <header className="header">
        <h1>Things</h1>
        <p className="meta">
          <span data-dyn="thingCount">3</span>
          {" things · stock "}
          <span data-dyn="stockTotal">59</span>
        </p>
      </header>
      <table className="card table">
        <thead>
          <tr><th>Name</th><th>Price</th><th></th></tr>
        </thead>
        <tbody data-list="things">
          <tr>
            <td data-dyn="name">Desk Lamp</td>
            <td data-dyn="price">$4,900</td>
            <td className="actions"><button data-action="edit">Edit</button></td>
          </tr>
          <tr>
            <td data-dyn="name">Notebook</td>
            <td data-dyn="price">$350</td>
            <td className="actions"><button data-action="edit">Edit</button></td>
          </tr>
          <tr>
            <td data-dyn="name">Kettle</td>
            <td data-dyn="price">$2,100</td>
            <td className="actions"><button data-action="edit">Edit</button></td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}

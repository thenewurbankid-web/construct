// Designed page (static, as exported from the design tool).
// Mark the dynamic parts:  data-dyn="name"  ·  data-list="name"  ·  data-action="verb"
export default function DesignedPage() {
  return (
    <main className="page">
      <header className="header">
        <h1>Roster</h1>
        <p className="meta">
          <span data-dyn="projectCount">3</span>
          {" projects · planned "}
          <span data-dyn="plannedTotal">$245.0K</span>
          {" · forecast "}
          <span data-dyn="forecastTotal">$245.0K</span>
        </p>
      </header>

      <form className="card form" data-action="save">
        <input name="project" placeholder="Project" required />
        <input name="lead" placeholder="Lead" required />
        <input name="deputy" placeholder="Deputy" required />
        <button type="submit" className="primary">Save</button>
        <button type="button" data-action="cancel">Cancel</button>
      </form>

      <table className="card table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Owner</th>
            <th>Backup</th>
            <th></th>
          </tr>
        </thead>
        <tbody data-list="roster">
          <tr>
            <td data-dyn="project">Apollo</td>
            <td data-dyn="owner">Lena</td>
            <td data-dyn="backup">Lena</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="project">Borealis</td>
            <td data-dyn="owner">Arjun</td>
            <td data-dyn="backup">Arjun</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="project">Cirrus</td>
            <td data-dyn="owner">Mia</td>
            <td data-dyn="backup">Mia</td>
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

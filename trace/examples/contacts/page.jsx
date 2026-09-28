// Designed page (static, as exported from the design tool).
// Mark the dynamic parts:  data-dyn="name"  ·  data-list="name"  ·  data-action="verb"
export default function DesignedPage() {
  return (
    <main className="page">
      <header className="header">
        <h1>Contacts</h1>
        <p className="meta">
          <span data-dyn="contactCount">3</span>
          {" contacts · directory updated "}
          <span data-dyn="directoryUpdated">26 Sep 2026</span>
        </p>
      </header>

      <form className="card form" data-action="save">
        <input name="first" placeholder="First name" required />
        <input name="last" placeholder="Last name" required />
        <input name="email" placeholder="Email" required />
        <input name="city" placeholder="City" required />
        <button type="submit" className="primary">Save</button>
        <button type="button" data-action="cancel">Cancel</button>
      </form>

      <table className="card table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Initials</th>
            <th>Email</th>
            <th>City</th>
            <th></th>
          </tr>
        </thead>
        <tbody data-list="contacts">
          <tr>
            <td data-dyn="fullName">Lena Kumar</td>
            <td data-dyn="initials">LK</td>
            <td data-dyn="email">lena@example.com</td>
            <td data-dyn="city">Pune</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="call">Call</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="fullName">Arjun Rao</td>
            <td data-dyn="initials">AR</td>
            <td data-dyn="email">arjun@example.com</td>
            <td data-dyn="city">Delhi</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="call">Call</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
          <tr>
            <td data-dyn="fullName">Mia Shah</td>
            <td data-dyn="initials">MS</td>
            <td data-dyn="email">mia@example.com</td>
            <td data-dyn="city">Mumbai</td>
            <td className="actions">
              <button data-action="edit">Edit</button>
              <button data-action="call">Call</button>
              <button data-action="delete" className="danger">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}

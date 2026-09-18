// Externally authored by a design tool (Subframe-style). FROZEN: Construct
// never edits or scaffolds into this file; projects wrap it from a controller.
export default function CpoHome(props: { title: string; items: string[] }) {
  return (
    <div className="home">
      <header>
        <h1>{props.title}</h1>
        <nav>
          <a href="/">Home</a>
          <a href="/reports">Reports</a>
        </nav>
      </header>
      <main>
        <section>
          <h2>Overview</h2>
          <ul>
            {props.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </main>
      <footer>
        <small>Design system</small>
      </footer>
    </div>
  );
}

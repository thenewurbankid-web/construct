// BAD: different name, but the same JSX structure as the frozen screen.
export function HomeShell(props: { title: string; items: string[] }) {
  return (
    <div className="shell">
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
        <small>Copy</small>
      </footer>
    </div>
  );
}

import CpoHome from '../../../../design-system/screens/CpoHome';

// BAD: imports the frozen screen but re-authors a lot of markup around it
// instead of just forwarding props.
export function CpoHomeController() {
  return (
    <div>
      <header>
        <h1>Extra banner</h1>
        <p>Hand-written around the frozen screen</p>
      </header>
      <section>
        <ul>
          <li>one</li>
        </ul>
      </section>
      <CpoHome title="CPO" items={['Alpha']} />
    </div>
  );
}

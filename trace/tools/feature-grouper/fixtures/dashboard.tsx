import React from "react";

type Stat = { label: string; value: string; delta: string };
type Activity = { id: string; who: string; what: string; when: string };

export default function Dashboard({ stats, activity, onInvite }: { stats: Stat[]; activity: Activity[]; onInvite: (email: string) => void }) {
  return (
    <main className="dashboard">
      <header className="topbar">
        <img src="/logo.svg" alt="logo" className="logo" />
        <nav className="topnav">
          <a href="/overview">Overview</a>
          <a href="/reports">Reports</a>
          <a href="/settings">Settings</a>
          <button type="button" onClick={() => {}}>Sign out</button>
        </nav>
      </header>

      <section className="kpis">
        <article className="card">
          <h3>Revenue</h3>
          <p className="value">1</p>
          <span className="delta">+2%</span>
        </article>
        <article className="card">
          <h3>Orders</h3>
          <p className="value">2</p>
          <span className="delta">+5%</span>
        </article>
        <article className="card">
          <h3>Refunds</h3>
          <p className="value">3</p>
          <span className="delta">-1%</span>
        </article>
      </section>

      <form className="invite" onSubmit={(e) => { e.preventDefault(); onInvite("x"); }}>
        <label htmlFor="email">Invite a teammate</label>
        <input id="email" name="email" type="email" placeholder="Email" required />
        <select name="role">
          <option value="viewer">Viewer</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit">Send invite</button>
      </form>

      <table className="activity">
        <thead>
          <tr>
            <th>Who</th>
            <th>What</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {activity.map((a) => (
            <tr key={a.id}>
              <td>{a.who}</td>
              <td>{a.what}</td>
              <td>{a.when}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

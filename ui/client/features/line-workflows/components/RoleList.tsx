import type { LineWorkflow, LineWorkflowRole } from '../types';

type RoleListProps = { workflow: LineWorkflow; pages: string[]; busy: boolean; onChoose: (role: string, page: string) => void };

const pageOption = (p: string) => (
  <option key={p} value={p}>
    {p}
  </option>
);

/** A page name the role holds that is not a page of the feature: kept as an option so the select shows it, and said. */
function Stray({ role }: { role: LineWorkflowRole }) {
  if (role.pageOk) return null;
  return (
    <p className="lw-warn" role="note">
      {role.page} is not a page of this feature; choose one of its pages.
    </p>
  );
}

/** The pages the workflow needs: for each role, what it is for and which of the feature's pages fills it. Picking a
 * page adds a plan step at once; the person approves it in the Plan panel. */
export function RoleList({ workflow, pages, busy, onChoose }: RoleListProps) {
  if (!workflow.roles.length) return <p className="hint">This workflow needs no pages.</p>;
  const roleRow = (r: LineWorkflowRole) => {
    const choices = r.page && !pages.includes(r.page) ? [...pages, r.page] : pages;
    return (
      <li key={r.id} className="lw-role" data-testid="lw-role" data-role={r.id}>
        <label htmlFor={`lw-role-${r.id}`}>
          <span className="lw-role-name">{r.id}</span> <span className="lw-muted">{r.says}</span>
        </label>
        <select id={`lw-role-${r.id}`} value={r.page ?? ''} disabled={busy || pages.length === 0} onChange={(e) => onChoose(r.id, e.target.value)}>
          <option value="">Not chosen yet</option>
          {choices.map(pageOption)}
        </select>
        <Stray role={r} />
      </li>
    );
  };
  return (
    <ul className="lw-roles" aria-label={`Pages of ${workflow.name}`}>
      {workflow.roles.map(roleRow)}
    </ul>
  );
}

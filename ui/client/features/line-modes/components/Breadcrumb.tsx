import type { Crumb } from '@/lib/lineModes';

type BreadcrumbProps = { crumbs: Crumb[]; onCrumb: (crumb: Crumb) => void };

/** Chat mode's breadcrumb: where the person is ("Features › orders › OrdersPage › title"). Every crumb, the current one
 * too, switches to Under the hood at exactly that place. */
export function Breadcrumb({ crumbs, onCrumb }: BreadcrumbProps) {
  const items = crumbs.map(crumbItem(onCrumb));
  return (
    <nav className="lm-crumbs" aria-label="Where you are" data-testid="lm-breadcrumb">
      <ol>{items}</ol>
    </nav>
  );
}

const crumbItem = (onCrumb: (crumb: Crumb) => void) => (c: Crumb) => <CrumbItem key={c.id} crumb={c} onCrumb={onCrumb} />;

function CrumbItem({ crumb: c, onCrumb }: { crumb: Crumb; onCrumb: (crumb: Crumb) => void }) {
  return (
    <li>
      <button
        type="button"
        className="lm-crumb"
        data-testid="lm-crumb"
        data-crumb={c.id}
        data-line-control="shell.crumb"
        data-line-target={c.id}
        aria-current={c.current ? 'location' : undefined}
        title={`Open ${c.label} under the hood`}
        onClick={() => onCrumb(c)}
      >
        {c.label}
      </button>
    </li>
  );
}

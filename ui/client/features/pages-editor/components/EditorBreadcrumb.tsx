'use client';

type EditorBreadcrumbProps = {
  feature: string;
  file: string;
  nodeLabel?: string | null;
};

// The stage breadcrumb (#375): Pages > feature > file [> selected node]. A plain trail, not
// its own navigation yet -- the tree and Ctrl P quick-open remain how you move between files.
export function EditorBreadcrumb({ feature, file, nodeLabel }: EditorBreadcrumbProps) {
  const parts = ['Pages', feature, file, nodeLabel].filter((p): p is string => Boolean(p));
  return (
    <nav aria-label="Breadcrumb" className="pe-breadcrumb" data-testid="pe-breadcrumb">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && (
            <span className="pe-breadcrumb-sep" aria-hidden="true">
              {' / '}
            </span>
          )}
          <span className={i === parts.length - 1 ? 'pe-breadcrumb-current' : ''}>{part}</span>
        </span>
      ))}
    </nav>
  );
}

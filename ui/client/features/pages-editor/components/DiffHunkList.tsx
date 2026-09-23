import type { DiffHunk } from '../types';

// #81's own before/after diff rendering (originally inline in SnippetDiffPreview), pulled out
// (#533) so the Wrap-with preview can render the exact same look for MULTIPLE files without a
// second, near-identical render loop -- same `.snippet-diff`/`.diff-added`/`.diff-removed`/
// `.diff-context` classes either caller already relies on, so no existing spec's selectors change.
export function DiffHunkList({ hunks }: { hunks: DiffHunk[] }) {
  return (
    <pre className="snippet-diff">
      {hunks.map((hunk, i) => {
        const cls = hunk.added ? 'diff-added' : hunk.removed ? 'diff-removed' : 'diff-context';
        const prefix = hunk.added ? '+ ' : hunk.removed ? '- ' : '  ';
        const lines = hunk.value.replace(/\n$/, '').split('\n');
        return (
          <span key={i} className={cls}>
            {lines.map((line, j) => (
              <span className="diff-line" key={j}>
                {prefix}
                {line}
                {'\n'}
              </span>
            ))}
          </span>
        );
      })}
    </pre>
  );
}

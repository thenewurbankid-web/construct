import type { TagView } from '../types';

/** Draft / Plan ready / Plan out of date / Ran. */
export function StatusTag({ tag, testId = 'note-status' }: { tag: TagView; testId?: string }) {
  return <span className={`nt-tag nt-tag--${tag.tone}`} data-testid={testId}>{tag.label}</span>;
}

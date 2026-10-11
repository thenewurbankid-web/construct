import { isInWorkspace } from '@/lib/lineWorkspacePaths';

/** Line cu6: the quiet tag on a page outside the project's workspace folder (null or '' = no folder set, no tag). */
export function PageReadOnlyTag({ folder, file }: { folder: string | null; file: string }) {
  if (!folder || isInWorkspace(folder, file)) return null;
  return (
    <span className="lp-chip lp-chip--quiet" data-testid="line-read-only" title="Outside your workspace folder; Line will not change it.">
      Read-only
    </span>
  );
}

import { EmptyState } from '@/features/states';
import { LineComponentPreview } from '../components/LineComponentPreview';
import type { LinePreviewRoute } from '../types';

/** /components/preview?file=: one library component on its own, with its props, to try the preview alone. */
export function LinePreviewPage({ route }: { route: LinePreviewRoute }) {
  const { file, ready, name } = route;
  return (
    <div className="page page--screen lr-page" data-testid="line-preview-page">
      <div>
        <h1>{name}</h1>
        {file && <p className="lr-file">{file}</p>}
      </div>
      {file && <LineComponentPreview file={file} />}
      {ready && !file && (
        <EmptyState size="inline" title="No component chosen" hint="Open a library component from the Components screen, or add ?file=library/components/<Name>.tsx to this address." />
      )}
    </div>
  );
}

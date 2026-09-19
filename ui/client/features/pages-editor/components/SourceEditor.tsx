'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { SourceEditorProps } from '../types';
import { TextareaSourceEditor } from './TextareaSourceEditor';

// Monaco is browser-only and heavy: load it lazily, client-side only, so SSR
// and any environment without it render the textarea adapter instead.
const MonacoSourceEditor = dynamic(() => import('./MonacoSourceEditor').then((m) => m.MonacoSourceEditor), {
  ssr: false,
  loading: () => <p className="hint">Loading editor...</p>,
});

type Engine = 'monaco' | 'textarea';

// The one place that chooses an adapter. `engine="textarea"` forces the
// fallback (tests, SSR previews); otherwise Monaco, dropping to the textarea
// if Monaco's runtime cannot be loaded.
export function SourceEditor({ engine = 'monaco', ...props }: SourceEditorProps & { engine?: Engine }) {
  const [monacoFailed, setMonacoFailed] = useState(false);
  if (engine === 'textarea' || monacoFailed) return <TextareaSourceEditor {...props} />;
  return <MonacoSourceEditor {...props} onUnavailable={() => setMonacoFailed(true)} />;
}

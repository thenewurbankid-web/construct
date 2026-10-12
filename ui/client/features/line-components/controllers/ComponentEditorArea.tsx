'use client';

import '../components/line-components.css';
import { ComponentEditor } from '../components/ComponentEditor';
import { NewComponentForm } from '../components/NewComponentForm';
import { useComponentEditor } from '../hooks/useComponentEditor';
import type { AddStep } from '../types';

type Props = { file: string | null; addStep: AddStep; revision: number; library: { id: string; name: string }[]; features: string[] };

/** The Components screen's editor area (cu4): the editor for the open component and New component. Every change is a
 * step of the screen's plan (`addStep`), approved in its Plan panel; `revision` re-reads the component once one lands. */
export function ComponentEditorArea({ file, addStep, revision, library, features }: Props) {
  const view = useComponentEditor(file, addStep, revision);
  return (
    <div className="lc-area" data-testid="lc-area">
      <ComponentEditor view={view} />
      {library.length && features.length ? <NewComponentForm view={view} library={library} features={features} /> : null}
    </div>
  );
}

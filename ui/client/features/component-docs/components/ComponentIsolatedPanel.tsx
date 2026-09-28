'use client';

import { useEffect, useState } from 'react';
import { LoadingState } from '@/features/states';
import { useComponentWorkflow } from '../hooks/useComponentWorkflow';
import { FlowInset } from './FlowInset';
import { IsolatedComponentPreview } from './IsolatedComponentPreview';
import { StateSwitcher } from './StateSwitcher';

type Props = { path: string };

/** #380 "one component on its own": the isolated preview, with a State switcher and Flow inset driven
 * by the component's own machine (found by the same-name-file convention, `useComponentWorkflow`).
 * A component with no machine still gets the isolated preview, just without the switcher/inset. */
export function ComponentIsolatedPanel({ path }: Props) {
  const { workflow, loading } = useComponentWorkflow(path);
  const machine = workflow && workflow.ok ? (workflow.machines[0] ?? null) : null;
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    setCurrent(machine?.initial ?? null);
  }, [machine]);

  return (
    <section className="cd-isolated" data-testid="cd-isolated">
      <h2 className="cd-h3">Isolated view</h2>
      <IsolatedComponentPreview path={path} />
      {loading ? (
        <LoadingState size="inline" label="Looking for this component's machine" />
      ) : !workflow?.ok ? (
        <p className="status-error" role="alert" data-testid="cd-workflow-failed">
          {workflow?.error ?? "Couldn't read this component's workflow."}
        </p>
      ) : machine ? (
        <>
          <StateSwitcher machine={machine} current={current} onChange={setCurrent} />
          <FlowInset machine={machine} current={current} />
        </>
      ) : (
        <p className="cd-none" data-testid="cd-workflow-none">No machine drives this component (none named after it in its feature&apos;s workflows/ layer).</p>
      )}
    </section>
  );
}

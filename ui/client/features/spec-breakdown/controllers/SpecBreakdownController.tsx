'use client';

// #748 (R6) -- reads `?file=` (project-relative path to an accepted machine-spec.v1) and `?feature=` (used only
// when the spec itself has no `feature` field, same convention as `construct research spec --feature`) from the
// URL, loads the spec once, and wires the hook to SpecBreakdownPage.
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { ProjectGateController } from '@/features/project-gate';
import { useSpecBreakdown } from '../hooks/useSpecBreakdown';
import { SpecBreakdownPage } from '../pages/SpecBreakdownPage';

function SpecBreakdownScreen({ file, feature }: { file: string; feature: string }) {
  const s = useSpecBreakdown(file);
  useEffect(() => {
    void s.load();
  }, [s.load]);
  return <SpecBreakdownPage file={file} feature={feature || s.readBack?.feature || ''} {...s} />;
}

export function SpecBreakdownController() {
  const params = useSearchParams();
  const file = params.get('file');
  const feature = params.get('feature') ?? '';
  if (!file) return <p className="sb-error" role="alert" data-testid="sb-no-file">Open this screen with a spec file: /spec-breakdown?file=&lt;path&gt;.</p>;
  return (
    <ProjectGateController>
      <SpecBreakdownScreen file={file} feature={feature} />
    </ProjectGateController>
  );
}

import { Suspense } from 'react';
import { SpecBreakdownController } from '@/features/spec-breakdown/controllers/SpecBreakdownController';

// `useSearchParams` (`?file=`/`?feature=`) needs a Suspense boundary above it.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpecBreakdownController />
    </Suspense>
  );
}

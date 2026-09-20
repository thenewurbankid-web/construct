import { Suspense } from 'react';
import { ReviewController } from '@/features/review/controllers/ReviewController';

// `useSearchParams` (which change the URL names) needs a Suspense boundary above it.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ReviewController />
    </Suspense>
  );
}

// #454 -- loads threadmark-react only when NEXT_PUBLIC_REVIEW_OVERLAY=1 is set at build time.
// See ReviewOverlayFlag.ts for why this repeats the literal comparison instead of calling
// isReviewOverlayEnabled(): only this exact shape lets Next.js/webpack dead-code-eliminate the
// whole branch -- the dynamic import included -- from the default production bundle (the same
// mechanism `if (process.env.NODE_ENV !== 'production')` relies on elsewhere in this codebase,
// see lib/xstateInspector.ts). Never inline threadmark-react's own bundled dependencies
// (lucide-react, modern-screenshot) anywhere outside this dynamic import.
export async function loadReviewOverlay() {
  if (process.env.NEXT_PUBLIC_REVIEW_OVERLAY === '1') {
    return import('threadmark-react');
  }
  return null;
}

// #454 -- build-time stand-in for ReviewOverlayLoader.ts, used ONLY when
// NEXT_PUBLIC_REVIEW_OVERLAY is not "1" at build time (see next.config.ts's webpack
// `resolve.alias`). This file makes no reference to threadmark-react at all, so aliasing to it
// removes even the `import('threadmark-react')` call itself from the compiled output of a
// flag-off build -- not just the package's code, but the literal request string, from every
// build artifact (chunks, and Next's own react-loadable-manifest bookkeeping, which records the
// source-level import specifier text regardless of what it resolves to).
export async function loadReviewOverlay(): Promise<null> {
  return null;
}

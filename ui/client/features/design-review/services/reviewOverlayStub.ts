// #454 -- build-time stand-in for threadmark-react, used ONLY when NEXT_PUBLIC_REVIEW_OVERLAY is
// not "1" at build time (see next.config.ts's webpack `resolve.alias`). Aliasing to this empty
// module -- rather than letting webpack bundle the real package and just never call it -- is what
// keeps the package's own code (and its dependencies, lucide-react and modern-screenshot) out of
// the compiled output entirely: no chunk, no reference, nothing to grep for. ReviewOverlayLoader.ts
// never actually reaches this in a flag-off build (its own literal env check already short-circuits
// first), so what this module exports does not matter at runtime -- it only has to exist so the
// aliased import resolves during the webpack build.
export {};

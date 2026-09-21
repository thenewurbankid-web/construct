// #454 -- dev-only design-review overlay (threadmark-react): on only when this flag is the
// exact string "1". Kept as a tiny, separately-tested predicate for anything that wants to read
// whether the overlay is on. The actual gate in ReviewOverlayLoader.ts repeats this same one-line
// comparison directly rather than calling this function, because webpack's production dead-code
// elimination for NEXT_PUBLIC_* env checks only recognises a literal
// `process.env.SOMETHING === 'value'` comparison written in the same scope as the code it
// guards -- routing it through a function call would keep threadmark-react in the production
// bundle. Verified against a real `next build`; see docs/design/README.md.
export function isReviewOverlayEnabled(flag: string | undefined): boolean {
  return flag === '1';
}

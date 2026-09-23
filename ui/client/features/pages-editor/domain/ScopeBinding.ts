// Pure (DOMAIN-001) — the type-fit rule for the Scope tab's click-to-bind flow (#534). A candidate is
// disqualified from a bind ONLY when both its own type and the armed target's declared type are known
// and they provably differ; an unknown type on either side is never treated as a mismatch. This
// mirrors the block palette's own "shape-fit, not semantic-fit; never hide what the type system
// hasn't actually ruled out" rule (docs/design/scope-binding.md §1) — a wrong-looking same-typed
// candidate (`customer.id` next to `customer.email`) still shows as fit; only a real, known mismatch
// is dimmed.
export function normalizeTypeText(type: string): string {
  return type.replace(/\s+/g, ' ').trim();
}

export function typeFits(sourceType: string | null, targetType: string | null): boolean {
  if (!sourceType || !targetType) return true;
  return normalizeTypeText(sourceType) === normalizeTypeText(targetType);
}

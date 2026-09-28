// #381 — what the Inspector's Change tab hands the live preview to draw: everything about the
// pending refactor a person needs while looking at the app, nothing about how it was computed.
export type ChangeImpactPreview = {
  verb: 'move' | 'rename';
  /** "Move Billing to component" / "Rename BillingView to BillingSummary" — one line, no paths. */
  label: string;
  /** Every file the dry run says it will touch, checked ones first (the ones that will be approved). */
  files: { path: string; checked: boolean }[];
};

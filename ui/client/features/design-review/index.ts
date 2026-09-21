// Public API for feature: design-review
//
// Dev-only design-review overlay (threadmark-react, #454): lets the owner and the designer agent
// annotate real Cockpit screens instead of writing prose feedback. Off by default and off in the
// hosted build -- only NEXT_PUBLIC_REVIEW_OVERLAY=1 turns it on. See docs/design/README.md.

/** Whether the overlay is allowed to run (the exact string "1"). */
export * from './domain/ReviewOverlayFlag';

/** Mount once, near the app root. Renders nothing unless the flag is on. */
export * from './controllers/ReviewOverlayController';

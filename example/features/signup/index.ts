// Public API for feature: signup

/** Shared identifier and value types for the signup feature. */
export type * from './types';

/** Renders the signup form and wires it to the signup workflow. */
export * from './controllers/SignupController';

/** React hook driving the signup state machine, form state, and redirect on success. */
export * from './hooks/useSignup';

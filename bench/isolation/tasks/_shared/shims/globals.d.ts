// The lending project types against @types/react 18, where JSX is a global namespace; the harness resolves
// React 19 types. Re-expose the global JSX namespace so `JSX.Element` return types compile the same way.
import type * as React from 'react';

declare global {
  namespace JSX {
    interface Element extends React.JSX.Element {}
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
  }
}

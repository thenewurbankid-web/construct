import type { ComponentProps, ReactNode } from 'react';
import { RecentClones } from '../components/RecentClones';

// Presentation-only (PAGE-002..006): composes its component from props.
export function RecentClonesPage(props: ComponentProps<typeof RecentClones>): ReactNode {
  return <RecentClones {...props} />;
}

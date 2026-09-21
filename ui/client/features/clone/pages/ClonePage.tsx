import type { ComponentProps, ReactNode } from 'react';
import { CloneForm } from '../components/CloneForm';
import { ConnectRemoteForm } from '../components/ConnectRemoteForm';
import { CloneJobList } from '../components/CloneJobList';
import { RecentClones } from '../components/RecentClones';

// Presentation-only (PAGE-002..006): each page just composes its component from props.
export function ClonePage(props: ComponentProps<typeof CloneForm>): ReactNode {
  return <CloneForm {...props} />;
}

export function ConnectRemotePage(props: ComponentProps<typeof ConnectRemoteForm>): ReactNode {
  return <ConnectRemoteForm {...props} />;
}

export function CloneJobsPage(props: ComponentProps<typeof CloneJobList>): ReactNode {
  return <CloneJobList {...props} />;
}

export function RecentClonesPage(props: ComponentProps<typeof RecentClones>): ReactNode {
  return <RecentClones {...props} />;
}

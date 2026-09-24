import type { ComponentProps, ReactNode } from 'react';
import { GithubConnectionRow } from '../components/GithubConnectionRow';

// Presentation-only (PAGE-002..006): the Settings row for the GitHub connection (#638), composed from props.
export function GithubConnectionPage(props: ComponentProps<typeof GithubConnectionRow>): ReactNode {
  return <GithubConnectionRow {...props} />;
}

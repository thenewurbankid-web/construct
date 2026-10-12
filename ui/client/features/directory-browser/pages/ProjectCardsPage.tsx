import type { ReactNode } from 'react';
import { ProjectCards } from '../components/ProjectCards';
import type { ProjectCardsProps } from '../types';

// Presentation-only (PAGE-002..006): composes the project cards from props.
export function ProjectCardsPage(props: ProjectCardsProps): ReactNode {
  return <ProjectCards {...props} />;
}

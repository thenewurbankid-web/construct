import type { ComponentProps, ReactNode } from 'react';
import { NewProjectForm } from '../components/NewProjectForm';

// Presentation-only (PAGE-002..006): the page just composes its component from props.
export function NewProjectPage(props: ComponentProps<typeof NewProjectForm>): ReactNode {
  return <NewProjectForm {...props} />;
}

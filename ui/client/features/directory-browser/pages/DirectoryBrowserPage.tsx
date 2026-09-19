import type { ReactNode } from 'react';
import { DirectoryPicker } from '../components/DirectoryPicker';
import type { DirectoryPickerProps } from '../types';

// Presentation-only (PAGE-002..006): composes the picker from props.
export function DirectoryBrowserPage(props: DirectoryPickerProps): ReactNode {
  return <DirectoryPicker {...props} />;
}

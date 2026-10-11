'use client';

import { useUrlSelection } from '@/features/list-browser';
import { componentName } from '../domain/RenderName';
import type { LinePreviewRoute } from '../types';

/** /components/preview?file=: the chosen library component file, once the address has been read. */
export function useLinePreviewRoute(): LinePreviewRoute {
  const { value, ready } = useUrlSelection('file');
  return { file: value, ready, name: value ? componentName(value) : 'Component preview' };
}

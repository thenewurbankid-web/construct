'use client';

import { useStatesGallery } from '../hooks/useStatesGallery';
import { StatesGalleryPage } from '../pages/StatesGalleryPage';

export function StatesGalleryController() {
  const { retries, retrying, retry } = useStatesGallery();
  return <StatesGalleryPage retries={retries} retrying={retrying} onRetry={retry} />;
}

'use client';

import { useOllama } from '../hooks/useOllama';
import { OllamaPage } from '../pages/OllamaPage';

export function OllamaController() {
  const ollama = useOllama();
  return <OllamaPage {...ollama} />;
}

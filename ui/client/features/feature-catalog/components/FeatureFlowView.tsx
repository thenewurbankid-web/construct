'use client';

import { useState } from 'react';
import { FlowBrowserController } from '@/features/flow-browser';
import { FlowFilePeekController } from '@/features/pages-editor';
import { MissingLayers } from './MissingLayers';
import './feature-catalog.css';

type Props = { name: string; missingLayers: string[]; onAddLayer: () => void };

/** The Flow view of the feature structure (#790): the same route -> controller -> behaviour/render tree the
 * Pages editor's Flow tab draws (#328, arrows in real import direction, not LAYER_ORDER), reused as-is via
 * FlowBrowserController. A missing layer isn't a file the import graph can draw, so it's appended below as a
 * dashed node -- the same MissingLayers block the Tree view uses, wired to the same Add action. */
export function FeatureFlowView({ name, missingLayers, onAddLayer }: Props) {
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <section className="fc-details" data-testid="fc-flow-details">
      <FlowBrowserController feature={name} onOpenFile={setOpened} />
      <MissingLayers layers={missingLayers} onAdd={onAddLayer} />
      {opened && <FlowFilePeekController key={opened} feature={name} file={opened} onClose={() => setOpened(null)} />}
    </section>
  );
}

'use client';

import '../components/blocks.css';
import { blockRunRequest, modelPatch } from '../domain/BlockRun';
import { buildBlocksView } from '../domain/BlocksView';
import type { BlockRunRequest } from '../domain/BlockTypes';
import { useBlocks } from '../hooks/useBlocks';
import { BlocksBrowser } from '../components/BlocksBrowser';

/** The Blocks tab of the Features screen's Browser pane (#407): every mechanical block with this project's settings.
 * "Run this block" builds one step and hands it to `onRunBlock` (the Plan screen adds it to its plan); it starts nothing
 * itself. Nothing here calls a model, and the settings are never sent to one. */
export function BlocksController({ onRunBlock }: { onRunBlock?: (request: BlockRunRequest) => void }) {
  const b = useBlocks();
  const view = buildBlocksView(b.state);
  return (
    <BlocksBrowser
      view={view}
      onFilter={b.setFilter}
      onToggle={(id, enabled) => void b.patch(id, { enabled })}
      onEngine={(id, engine) => void b.patch(id, { engine })}
      onModel={(id, text) => void b.patch(id, modelPatch(text))}
      onRun={onRunBlock && ((id) => {
        const row = b.state.blocks.find((x) => x.id === id);
        const request = row ? blockRunRequest(row) : null;
        if (request) onRunBlock(request);
      })}
      onRetry={() => void b.load()}
      onReset={() => void b.reset()}
    />
  );
}

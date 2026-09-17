'use client';

import { usePropRow } from '../hooks/usePropRow';
import type { PageTree, PropData } from '../types';
import { SaveStatus } from './SaveStatus';

type PropRowProps = {
  feature: string;
  file: string;
  nodeId: string;
  contentHash: string;
  prop: PropData;
  onSaved: (tree: PageTree) => void;
};

// #53 — one generated prop-edit form control, driven by usePropRow.
export function PropRow({ feature, file, nodeId, contentHash, prop, onSaved }: PropRowProps) {
  const { kind, value, setValue, busy, status, save } = usePropRow(feature, file, nodeId, contentHash, prop, onSaved);
  return (
    <div className="prop-row">
      <span className="prop-name">{prop.name}</span>
      {kind === 'boolean' ? (
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => setValue(e.target.checked)} />
      ) : kind === 'number' ? (
        <input type="number" value={value as number} onChange={(e) => setValue(Number(e.target.value))} />
      ) : (
        <input type="text" value={value as string} onChange={(e) => setValue(e.target.value)} />
      )}
      <button type="button" onClick={save} disabled={busy}>
        {busy ? '…' : 'Save'}
      </button>
      {status && <SaveStatus status={status} />}
    </div>
  );
}

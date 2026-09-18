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

// #53 — one generated prop-edit form control, driven by usePropRow. #77
// follow-up: a spread prop (`{...rest}`, no attribute name) now renders as
// a row too, labeled via propLabel instead of the (null) prop.name; any
// row whose value is raw code rather than a plain string/number/boolean
// (identifier, expression, or spread) gets a visible "expression" hint so
// the raw-text fallback input isn't mistaken for a broken plain-string
// field.
export function PropRow({ feature, file, nodeId, contentHash, prop, onSaved }: PropRowProps) {
  const { kind, label, isSpread, value, setValue, busy, status, save } = usePropRow(feature, file, nodeId, contentHash, prop, onSaved);
  return (
    <div className="prop-row">
      <span className="prop-name">{label}</span>
      {kind === 'expression' && (
        <span className="prop-kind-hint" title="Edited as raw code, not a plain string">
          {isSpread ? 'spread' : 'expression'}
        </span>
      )}
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

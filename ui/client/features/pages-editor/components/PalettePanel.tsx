'use client';

import type { ReactNode } from 'react';
import { GlassPanel } from '@/components/ui';
import { usePalette } from '../hooks/usePalette';
import { usePaletteInsert } from '../hooks/usePaletteInsert';
import { usePaletteWrap } from '../hooks/usePaletteWrap';
import { SaveStatus } from './SaveStatus';
import { WrapPreview } from './WrapPreview';
import type { PageTree, PaletteChipKind, PaletteEntry, WrapFit } from '../types';

type PalettePanelProps = { feature: string; file: string; contentHash: string; selectedNodeId?: string | null; onInserted: (tree: PageTree) => void };

type InsertFn = (kind: PaletteChipKind, entry: PaletteEntry) => void;

type WrapEntry = PaletteEntry & { fit?: WrapFit; reason?: string | null };

type GroupProps = {
  title: string;
  chip: PaletteChipKind;
  entries: WrapEntry[];
  empty: string;
  onInsert?: InsertFn;
  isPending?: (kind: PaletteChipKind, entry: PaletteEntry) => boolean;
  /** Rendered as the group's own top row(s), before its entries — #533's "+ New Expression". */
  leading?: ReactNode;
};

const CHIP_LABEL: Record<PaletteChipKind, string> = { provider: 'provider', expression: 'expression', component: 'component' };

const FIT_LABEL: Record<Exclude<WrapFit, 'unknown'>, string> = { fits: 'Fits this selection', 'not-a-fit': 'Not a fit' };

// #532 (Slice 2 of #518's design) -- only Components and Providers get an Insert action; Expressions
// stay pure reference for now. #533 (Slice 3) adds a per-row "fit" indicator to an Expression row ONLY
// once a JSX selection flags something Wrap-able — every other row (and every row before a selection
// exists) renders exactly as Slice 1/2 already shipped it.
function PaletteEntryRow({ entry, chip, onInsert, pending }: { entry: WrapEntry; chip: PaletteChipKind; onInsert?: InsertFn; pending?: boolean }) {
  const dim = entry.fit === 'not-a-fit';
  return (
    <div className={`pal-item${dim ? ' pal-item--dim' : ''}`}>
      <div className="pal-name">
        <span className={`pal-chip pal-chip--${chip}`}>{CHIP_LABEL[chip]}</span>
        <b>{entry.name}</b>
        {entry.fit && entry.fit !== 'unknown' && <span className={`pal-chip pal-chip--fit-${entry.fit}`}>{FIT_LABEL[entry.fit]}</span>}
        {onInsert && (
          <button type="button" className="pal-insert" disabled={pending} onClick={() => onInsert(chip, entry)}>
            {pending ? 'Inserting…' : 'Insert'}
          </button>
        )}
      </div>
      <span className="pal-path">{entry.via ? `${entry.feature} · via its public index` : entry.path}</span>
      {dim && entry.reason ? <p className="pal-desc">{entry.reason}</p> : entry.description && <p className="pal-desc">{entry.description}</p>}
    </div>
  );
}

function PaletteGroup({ title, chip, entries, empty, onInsert, isPending, leading }: GroupProps) {
  return (
    <details className="pal-group" open>
      <summary>
        {title} <span className="pal-count">{entries.length}</span>
      </summary>
      {leading}
      {entries.length === 0 ? (
        <p className="hint pal-empty">{empty}</p>
      ) : (
        entries.map((e) => (
          <PaletteEntryRow key={`${chip}:${e.path}:${e.name}`} entry={e} chip={chip} onInsert={onInsert} pending={isPending?.(chip, e)} />
        ))
      )}
    </details>
  );
}

// #527 (Slice 1) + #532 (Slice 2) + #533 (Slice 3, "Wrap with...") of #518's design,
// docs/design/block-palette.md. Slice 1: read-only browsing/reference view of what THIS feature's
// pages can actually import -- real Provider hooks, Expressions and Components in scope, computed
// server-side from the canImport graph (packages/engine/palette.mjs). Slice 2, strictly additive:
// clicking "Insert" on a Component or Provider row adds its real import + usage at the end of the
// currently open page (ui/server/src/pagesEditor.mjs's buildPaletteInsertion). Slice 3, also strictly
// additive and only ever active once `selectedNodeId` (the same tree/preview selection every other
// tab already uses) lands inside a PAGE-008-flagged conditional/loop: the Expressions group re-sorts
// with fit-checked suggestions, and "+ New Expression" triggers the real `extractExpression()`
// codemod (#517) via a preview-then-approve flow -- nothing is written until "Approve". No selection,
// or a selection that isn't flagged: this whole panel renders byte-for-byte as Slice 1/2 already did.
export function PalettePanel({ feature, file, contentHash, selectedNodeId, onInserted }: PalettePanelProps) {
  const { data, error, loading, refetch } = usePalette(feature);
  const { insert, isPending, status } = usePaletteInsert(feature, file, contentHash, onInserted);
  const wrap = usePaletteWrap(feature, file, contentHash, selectedNodeId ?? null, onInserted, refetch);

  const hit = wrap.suggestion?.hit ?? null;
  const expressionEntries: WrapEntry[] = hit ? wrap.suggestion!.suggestions : data?.expressions ?? [];
  const anyExistingFits = hit ? expressionEntries.some((e) => e.fit === 'fits') : false;

  const newExpressionRow = hit && (
    <div className="pal-wrap-new">
      <p className="pal-wrap-callout" data-testid="wrap-callout">
        {hit.summary}
      </p>
      {anyExistingFits && (
        <p className="hint pal-wrap-note">No mechanical block yet to wrap with an existing Expression here — reuse one by hand, or create a new one below.</p>
      )}
      {!wrap.suggestion?.files ? (
        <div className="pal-wrap-name-row">
          <input
            type="text"
            className="pal-wrap-name-input"
            placeholder="New Expression name"
            aria-label="New Expression name"
            value={wrap.name}
            onChange={(e) => wrap.setName(e.target.value)}
          />
          <button type="button" className="btn" data-testid="wrap-with-button" disabled={!wrap.name || wrap.loading} onClick={wrap.preview}>
            {wrap.loading ? 'Checking…' : 'Wrap with…'}
          </button>
        </div>
      ) : (
        <WrapPreview files={wrap.suggestion.files} busy={wrap.confirming} onConfirm={wrap.confirm} onCancel={wrap.cancelPreview} />
      )}
      {wrap.suggestion?.nameError && <p className="status-error">{wrap.suggestion.nameError}</p>}
    </div>
  );

  return (
    <GlassPanel className="pal-panel">
      <h3>Palette</h3>
      <p className="hint">What this page&rsquo;s feature could add: Providers, Expressions and Components it can actually reach.</p>
      {loading && <p className="hint">Reading the import graph for this feature&hellip;</p>}
      {error && <p className="status-error">{error}</p>}
      {data && (
        <>
          <PaletteGroup title="Providers this feature can use" chip="provider" entries={data.providers} empty="No Provider hooks in scope yet." onInsert={insert} isPending={isPending} />
          <PaletteGroup
            title="Expressions this feature can wrap with"
            chip="expression"
            entries={expressionEntries}
            empty="This feature has no Expressions yet — Expressions appear here once one is extracted or created."
            leading={newExpressionRow}
          />
          <PaletteGroup title="Components this feature can compose" chip="component" entries={data.components} empty="No Components in scope yet." onInsert={insert} isPending={isPending} />
          {status && <SaveStatus status={status} />}
          {wrap.status && <SaveStatus status={wrap.status} />}
          <p className="pal-boundary">
            <b>Not shown here:</b> workflows, services and domain logic. A page composes components, expressions and providers only — it can&rsquo;t reach a workflow, service or domain unit directly (rules PAGE-002/003/005). Ask a controller to wire one of those in instead.
          </p>
        </>
      )}
    </GlassPanel>
  );
}

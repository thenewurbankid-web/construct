'use client';

import { GlassPanel } from '@/components/ui';
import { usePalette } from '../hooks/usePalette';
import { usePaletteInsert } from '../hooks/usePaletteInsert';
import { SaveStatus } from './SaveStatus';
import type { PageTree, PaletteChipKind, PaletteEntry } from '../types';

type PalettePanelProps = { feature: string; file: string; contentHash: string; onInserted: (tree: PageTree) => void };

type InsertFn = (kind: PaletteChipKind, entry: PaletteEntry) => void;

type GroupProps = {
  title: string;
  chip: PaletteChipKind;
  entries: PaletteEntry[];
  empty: string;
  onInsert?: InsertFn;
  isPending?: (kind: PaletteChipKind, entry: PaletteEntry) => boolean;
};

const CHIP_LABEL: Record<PaletteChipKind, string> = { provider: 'provider', expression: 'expression', component: 'component' };

// #532 (Slice 2 of #518's design) -- only Components and Providers get an Insert action; Expressions
// stay pure reference for now (Slice 3, "Wrap with...", needs #517's extraction block + a selection
// UI -- a separate, later ticket).
function PaletteEntryRow({ entry, chip, onInsert, pending }: { entry: PaletteEntry; chip: PaletteChipKind; onInsert?: InsertFn; pending?: boolean }) {
  return (
    <div className="pal-item">
      <div className="pal-name">
        <span className={`pal-chip pal-chip--${chip}`}>{CHIP_LABEL[chip]}</span>
        <b>{entry.name}</b>
        {onInsert && (
          <button type="button" className="pal-insert" disabled={pending} onClick={() => onInsert(chip, entry)}>
            {pending ? 'Inserting…' : 'Insert'}
          </button>
        )}
      </div>
      <span className="pal-path">{entry.via ? `${entry.feature} · via its public index` : entry.path}</span>
      {entry.description && <p className="pal-desc">{entry.description}</p>}
    </div>
  );
}

function PaletteGroup({ title, chip, entries, empty, onInsert, isPending }: GroupProps) {
  return (
    <details className="pal-group" open>
      <summary>
        {title} <span className="pal-count">{entries.length}</span>
      </summary>
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

// #527 (Slice 1) + #532 (Slice 2) of #518's design, docs/design/block-palette.md. Slice 1: read-only
// browsing/reference view of what THIS feature's pages can actually import -- real Provider hooks,
// Expressions and Components in scope, computed server-side from the canImport graph
// (packages/engine/palette.mjs). Slice 2, strictly additive: clicking "Insert" on a Component or
// Provider row adds its real import + usage (a self-closing tag with required props stubbed, or a
// Provider hook call) at the end of the currently open page -- reusing the existing patch/enforcement
// mechanism the Pages editor already writes through (ui/server/src/pagesEditor.mjs's
// buildPaletteInsertion), never an LLM step. Expressions still have no action (Slice 3, "Wrap with...").
export function PalettePanel({ feature, file, contentHash, onInserted }: PalettePanelProps) {
  const { data, error, loading } = usePalette(feature);
  const { insert, isPending, status } = usePaletteInsert(feature, file, contentHash, onInserted);

  return (
    <GlassPanel className="pal-panel">
      <h3>Palette</h3>
      <p className="hint">What this page&rsquo;s feature could add: Providers, Expressions and Components it can actually reach.</p>
      {loading && <p className="hint">Reading the import graph for this feature&hellip;</p>}
      {error && <p className="status-error">{error}</p>}
      {data && (
        <>
          <PaletteGroup title="Providers this feature can use" chip="provider" entries={data.providers} empty="No Provider hooks in scope yet." onInsert={insert} isPending={isPending} />
          <PaletteGroup title="Expressions this feature can wrap with" chip="expression" entries={data.expressions} empty="This feature has no Expressions yet — Expressions appear here once one is extracted or created." />
          <PaletteGroup title="Components this feature can compose" chip="component" entries={data.components} empty="No Components in scope yet." onInsert={insert} isPending={isPending} />
          {status && <SaveStatus status={status} />}
          <p className="pal-boundary">
            <b>Not shown here:</b> workflows, services and domain logic. A page composes components, expressions and providers only — it can&rsquo;t reach a workflow, service or domain unit directly (rules PAGE-002/003/005). Ask a controller to wire one of those in instead.
          </p>
        </>
      )}
    </GlassPanel>
  );
}

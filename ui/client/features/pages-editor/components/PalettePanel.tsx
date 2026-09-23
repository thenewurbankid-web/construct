'use client';

import { GlassPanel } from '@/components/ui';
import { usePalette } from '../hooks/usePalette';
import type { PaletteChipKind, PaletteEntry } from '../types';

type PalettePanelProps = { feature: string };

type GroupProps = { title: string; chip: PaletteChipKind; entries: PaletteEntry[]; empty: string };

const CHIP_LABEL: Record<PaletteChipKind, string> = { provider: 'provider', expression: 'expression', component: 'component' };

function PaletteEntryRow({ entry, chip }: { entry: PaletteEntry; chip: PaletteChipKind }) {
  return (
    <div className="pal-item">
      <div className="pal-name">
        <span className={`pal-chip pal-chip--${chip}`}>{CHIP_LABEL[chip]}</span>
        <b>{entry.name}</b>
      </div>
      <span className="pal-path">{entry.via ? `${entry.feature} · via its public index` : entry.path}</span>
      {entry.description && <p className="pal-desc">{entry.description}</p>}
    </div>
  );
}

function PaletteGroup({ title, chip, entries, empty }: GroupProps) {
  return (
    <details className="pal-group" open>
      <summary>
        {title} <span className="pal-count">{entries.length}</span>
      </summary>
      {entries.length === 0 ? (
        <p className="hint pal-empty">{empty}</p>
      ) : (
        entries.map((e) => <PaletteEntryRow key={`${chip}:${e.path}:${e.name}`} entry={e} chip={chip} />)
      )}
    </details>
  );
}

// #527 (Slice 1 of #518's design, docs/design/block-palette.md) -- read-only browsing/reference view
// of what THIS feature's pages can actually import: real Provider hooks, Expressions and Components
// in scope, computed server-side from the canImport graph (packages/engine/palette.mjs). No
// insert/wrap interaction yet (Slices 2-3, separate future tickets) -- purely reference.
export function PalettePanel({ feature }: PalettePanelProps) {
  const { data, error, loading } = usePalette(feature);

  return (
    <GlassPanel className="pal-panel">
      <h3>Palette</h3>
      <p className="hint">What this page&rsquo;s feature could add: Providers, Expressions and Components it can actually reach.</p>
      {loading && <p className="hint">Reading the import graph for this feature&hellip;</p>}
      {error && <p className="status-error">{error}</p>}
      {data && (
        <>
          <PaletteGroup title="Providers this feature can use" chip="provider" entries={data.providers} empty="No Provider hooks in scope yet." />
          <PaletteGroup title="Expressions this feature can wrap with" chip="expression" entries={data.expressions} empty="This feature has no Expressions yet — Expressions appear here once one is extracted or created." />
          <PaletteGroup title="Components this feature can compose" chip="component" entries={data.components} empty="No Components in scope yet." />
          <p className="pal-boundary">
            <b>Not shown here:</b> workflows, services and domain logic. A page composes components, expressions and providers only — it can&rsquo;t reach a workflow, service or domain unit directly (rules PAGE-002/003/005). Ask a controller to wire one of those in instead.
          </p>
        </>
      )}
    </GlassPanel>
  );
}

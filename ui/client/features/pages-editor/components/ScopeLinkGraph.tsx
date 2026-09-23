import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { ScopeView } from '../types';
import { typeFits } from '../domain/ScopeBinding';

// Presentational renderer for a ScopeView (#223): sources on the left, target props on the right,
// one coloured curve per link. The only input is the view model, so a different renderer (xyflow, a
// table) can replace this file without touching the mapper, hook or server.
//
// #534 -- every row is now a real `<button>`, not a `<span>` (Slice 1's accessibility fix: today's
// rows had no click/focus/keyboard path at all), and target rows double as the "Bind…" control
// (Slice 2): pressing one arms it for linking; while armed, a fitting source becomes an enabled,
// focusable candidate (click, or Tab/Arrow + Enter/Space, to commit it onto the armed prop) and a
// type-mismatched one stays visible but disabled+dashed with its own real type, never hidden
// (docs/design/scope-binding.md §3). A source has no independent action outside of an active bind, so
// it is `disabled` (and so naturally out of the Tab order, same as any other inert control) until one
// is armed — the SVG stays purely decorative (`aria-hidden`), never load-bearing for meaning.
const ROW = 28;
const WIDTH = 330;
const COL_W = 118;
const PAD = 8;

const rowY = (i: number) => PAD + i * ROW + ROW / 2;

type ScopeLinkGraphProps = {
  view: ScopeView;
  /** The prop currently armed for linking, or null. */
  armed: string | null;
  onArm: (prop: string) => void;
  onCancel: () => void;
  onCommit: (candidateName: string) => void;
  busy: boolean;
};

export function ScopeLinkGraph({ view, armed, onArm, onCancel, onCommit, busy }: ScopeLinkGraphProps) {
  const height = PAD * 2 + Math.max(view.sources.length, view.targets.length, 1) * ROW;
  const sourceIndex = new Map(view.sources.map((s, i) => [s.name, i]));
  const targetIndex = new Map(view.targets.map((t, i) => [t.prop, i]));
  const armedTarget = armed ? view.targets.find((t) => t.prop === armed) ?? null : null;
  const containerRef = useRef<HTMLDivElement>(null);

  const fitsArmed = (sourceType: string | null) => !armed || typeFits(sourceType, armedTarget?.type ?? null);
  const enabledSourceIndexes = view.sources.map((s, i) => (armed && fitsArmed(s.type) ? i : -1)).filter((i) => i >= 0);

  // Keyboard path (docs/design/scope-binding.md §3): arming moves focus to the first enabled
  // candidate, never leaving focus stranded on nothing and never landing on a disabled one.
  useEffect(() => {
    if (!armed || enabledSourceIndexes.length === 0) return;
    const el = containerRef.current?.querySelector<HTMLButtonElement>(`.scope-source[data-index="${enabledSourceIndexes[0]}"]`);
    el?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the armed prop changes
  }, [armed]);

  function handleSourceKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    if (!armed || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const pos = enabledSourceIndexes.indexOf(index);
    if (pos === -1 || enabledSourceIndexes.length === 0) return;
    const nextPos = e.key === 'ArrowDown' ? (pos + 1) % enabledSourceIndexes.length : (pos - 1 + enabledSourceIndexes.length) % enabledSourceIndexes.length;
    containerRef.current?.querySelector<HTMLButtonElement>(`.scope-source[data-index="${enabledSourceIndexes[nextPos]}"]`)?.focus();
  }

  function handleTargetKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Escape' && armed) {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="scope-graph" style={{ width: WIDTH, height }} ref={containerRef}>
      <svg width={WIDTH} height={height} className="scope-graph-svg" aria-hidden="true">
        {view.edges.map((e) => {
          const y1 = rowY(sourceIndex.get(e.from) ?? 0);
          const y2 = rowY(targetIndex.get(e.to) ?? 0);
          const x1 = COL_W;
          const x2 = WIDTH - COL_W;
          return (
            <path
              key={`${e.from}->${e.to}`}
              className="scope-edge"
              data-from={e.from}
              data-to={e.to}
              d={`M ${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`}
              stroke={e.color}
              strokeWidth={2}
              fill="none"
            />
          );
        })}
      </svg>
      {view.sources.map((s, i) => {
        const fits = fitsArmed(s.type);
        const disabled = !armed || !fits;
        const mismatchNote = armed && !fits ? ` — does not fit ${armed} (${armedTarget?.type ?? 'unknown'})` : '';
        return (
          <button
            key={s.name}
            type="button"
            data-index={i}
            data-name={s.name}
            className={
              `scope-source scope-kind-${s.kind}` +
              (s.linked ? ' linked' : '') +
              (s.unusedInPage ? ' unused' : '') +
              (armed ? (fits ? ' scope-fit' : ' scope-unfit') : '')
            }
            style={{ top: PAD + i * ROW, left: 0, width: COL_W, borderColor: s.color, color: s.color }}
            title={`${s.kind}${s.type ? `: ${s.type}` : ''}${s.unusedInPage ? ' (never passed to any element)' : ''}${mismatchNote}`}
            disabled={disabled}
            aria-disabled={disabled}
            onClick={() => fits && armed && onCommit(s.name)}
            onKeyDown={(e) => handleSourceKeyDown(e, i)}
          >
            {s.name}
          </button>
        );
      })}
      {view.targets.map((t, i) => {
        const bindable = t.status !== 'spread';
        const isArmed = armed === t.prop;
        return (
          <button
            key={t.prop}
            type="button"
            data-prop={t.prop}
            className={`scope-target scope-status-${t.status}${isArmed ? ' armed' : ''}`}
            style={{ top: PAD + i * ROW, left: WIDTH - COL_W, width: COL_W, ...(t.color ? { borderColor: t.color, color: t.color } : {}) }}
            title={bindable ? `${t.text}${t.type ? ` — declared as ${t.type}` : ''} — press to ${isArmed ? 'cancel binding' : 'bind'} this prop` : t.text || 'A spread prop cannot be bound field-by-field'}
            disabled={!bindable || busy}
            aria-pressed={isArmed}
            onClick={() => onArm(t.prop)}
            onKeyDown={handleTargetKeyDown}
          >
            {t.prop}
            {t.text ? `=${t.text}` : ''}
          </button>
        );
      })}
    </div>
  );
}

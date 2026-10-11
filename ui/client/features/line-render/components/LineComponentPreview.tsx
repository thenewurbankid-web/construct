'use client';

import { useLineRender } from '../hooks/useLineRender';
import { RenderPicture } from './RenderPicture';
import { RenderPropRow } from './RenderPropRow';
import './line-render.css';

type LineComponentPreviewProps = { file: string };

/** One library component rendered alone with its props, ready to drop into any screen (the Library card detail,
 * /components/preview). The picture sits in a sandboxed frame; the props are plain rows, and changing a value
 * renders it again. With no picture (the renderer is not linked) it says why in one sentence and still lists the props. */
export function LineComponentPreview({ file }: LineComponentPreviewProps) {
  const { name, state, rows, busy, setProp } = useLineRender(file);
  return (
    <section className="lr" aria-label={`${name} preview`} data-testid="line-component-preview" aria-busy={busy}>
      <RenderPicture name={name} state={state} />
      <h3 className="lr-title">Props of {name}</h3>
      <ul className="lr-props" aria-label={`Props of ${name}`}>
        {rows.map((row) => (
          <RenderPropRow key={row.prop.name} row={row} onChange={(raw) => setProp(row.prop, raw)} />
        ))}
      </ul>
    </section>
  );
}

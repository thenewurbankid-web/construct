type Props = { layers: string[]; onAdd: () => void };

/** A missing layer, dashed, with its own Add action -- shared by the Tree and Flow views (#393, #790) so
 * a missing layer reads the same way no matter which one is on screen. */
export function MissingLayers({ layers, onAdd }: Props) {
  if (layers.length === 0) return null;
  return (
    <div data-testid="fc-missing-layers">
      {layers.map((layer) => (
        <div key={layer} className="fc-layer fc-layer-missing" data-testid="fc-layer-missing" data-layer={layer}>
          <h4 className="fc-h4">{layer} <span className="fc-hint">missing</span></h4>
          <button type="button" className="fc-link fc-link-btn" data-testid="fc-add-layer" onClick={onAdd}>Add</button>
        </div>
      ))}
    </div>
  );
}

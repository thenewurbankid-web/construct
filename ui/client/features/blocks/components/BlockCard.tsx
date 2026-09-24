'use client';

import { useState } from 'react';
import type { Engine } from '../domain/BlockTypes';
import { RUN_LABEL } from '../domain/BlockText';
import type { BlockCardView } from '../types';

type Props = {
  card: BlockCardView;
  onToggle: (id: string, enabled: boolean) => void;
  onEngine: (id: string, engine: Engine) => void;
  onModel: (id: string, model: string) => void;
  onRun?: (id: string) => void;
};

const ENGINES: { id: Engine; label: string }[] = [
  { id: 'mechanical', label: 'Mechanical' },
  { id: 'ai', label: 'AI' },
];

function ModelField({ card, onModel }: { card: BlockCardView; onModel: Props['onModel'] }) {
  const engine = card.engine;
  const [draft, setDraft] = useState(engine?.model ?? '');
  if (!engine) return null;
  return (
    <form
      className="bl-model"
      onSubmit={(e) => {
        e.preventDefault();
        onModel(card.id, draft.trim());
      }}
    >
      <label className="bl-model-label">
        <span>Default model ({engine.provider}, on this machine)</span>
        <input value={draft} placeholder="the local engine's own model" onChange={(e) => setDraft(e.target.value)} data-testid="block-model" spellCheck={false} />
      </label>
      <button type="submit" className="dg-btn" disabled={card.saving || draft.trim() === engine.model} data-testid="block-model-save">Save</button>
    </form>
  );
}

/** One block: what it is in plain words, whether it is on for this project, and (folded away) what it reads and writes,
 * its arguments, one example and its defaults. Presentation only: every change goes to the server through the props. */
export function BlockCard({ card, onToggle, onEngine, onModel, onRun }: Props) {
  return (
    <article className={`bl-card${card.enabled ? '' : ' bl-card--off'}`} data-testid="block-card" data-block-id={card.id} aria-label={`Block ${card.id}`}>
      <header className="bl-head">
        <h3 className="bl-name">{card.id}</h3>
        <label className="bl-switch">
          <input type="checkbox" checked={card.enabled} disabled={card.locked || card.saving} onChange={(e) => onToggle(card.id, e.target.checked)} aria-label={`Use ${card.id} in this project`} data-testid="block-toggle" />
          <span>{card.enabled ? 'On' : 'Off'}</span>
        </label>
      </header>
      <p className="bl-purpose">{card.purpose}</p>
      <p className="bl-chips">
        <span className={`bl-chip bl-chip--${card.kind.tone}`} data-testid="block-kind">{card.kind.label}</span>
        <span className={`bl-chip bl-chip--${card.model.tone}`} data-testid="block-model-calls">{card.model.label}</span>
      </p>
      <p className="bl-runs" data-testid="block-runs">{card.runs}</p>
      {card.offNote && <p className="bl-note" data-testid="block-off-note">{card.offNote}</p>}
      {card.refusal && <p className="bl-refusal" role="alert" data-testid="block-refusal">{card.refusal}</p>}
      {onRun && (
        <div className="bl-actions">
          <button type="button" className="dg-btn bl-run" disabled={card.runBlocked !== null} title={card.runBlocked ?? undefined} onClick={() => onRun(card.id)} data-testid="block-run">{RUN_LABEL}</button>
          {card.runBlocked && card.enabled && <span className="bl-runhint">{card.runBlocked}</span>}
        </div>
      )}
      <details className="pal-group bl-more" data-testid="block-details">
        <summary>Details</summary>
        <dl className="bl-facts">
          <dt>Reads</dt>
          <dd data-testid="block-reads">{card.reads}</dd>
          <dt>Writes</dt>
          <dd data-testid="block-writes">{card.writes}</dd>
          <dt>Arguments</dt>
          <dd>
            {card.args.length === 0 ? (
              'None.'
            ) : (
              <ul className="bl-args" data-testid="block-args">
                {card.args.map((a) => (
                  <li key={a.name} title={a.description ?? undefined}>
                    <code>{a.label}</code>: {a.kind}
                  </li>
                ))}
              </ul>
            )}
          </dd>
          {card.example && (
            <>
              <dt>Example</dt>
              <dd data-testid="block-example">
                {card.example.title}
                {card.example.command && <code className="bl-cmd">{card.example.command}</code>}
              </dd>
            </>
          )}
        </dl>
        {card.engine ? (
          <div className="bl-engine" data-testid="block-engine">
            <span className="bl-engine-label" id={`bl-engine-${card.id}`}>Default engine</span>
            <div className="bl-tags" role="group" aria-labelledby={`bl-engine-${card.id}`}>
              {ENGINES.map((e) => (
                <button key={e.id} type="button" aria-pressed={card.engine?.value === e.id} disabled={card.saving} onClick={() => onEngine(card.id, e.id)} data-testid={`block-engine-${e.id}`}>{e.label}</button>
              ))}
            </div>
            <ModelField key={card.engine.model} card={card} onModel={onModel} />
            <p className="bl-hint">Saved for this project. A step does not carry a model yet, so a run still uses the local engine&apos;s own model.</p>
          </div>
        ) : (
          card.enabled && <p className="bl-hint" data-testid="block-engine-fixed">Always mechanical: this block has no model path.</p>
        )}
      </details>
    </article>
  );
}

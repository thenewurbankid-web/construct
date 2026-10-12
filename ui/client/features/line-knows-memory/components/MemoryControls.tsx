import { useRef, useState } from 'react';
import type { MemoryTabAction } from '../workflows/MemoryActions';
import { embeddingsHelp } from '../domain/MemoryTab';

type Act = { busy: boolean; act: (action: MemoryTabAction) => void };

/** The embeddings switch: off by default; slotted decision text only, never code. */
export function EmbeddingsSwitch({ on, runs, busy, act }: Act & { on: boolean; runs: boolean }) {
  return (
    <div className="lkm-switch">
      <button type="button" role="switch" aria-checked={on} aria-describedby="lkm-embed-help" onClick={() => act({ kind: 'embeddings', on: !on })} disabled={busy} data-testid="memory-embeddings">
        <span className="lkm-knob" aria-hidden="true" />
        Embeddings {on ? 'on' : 'off'}
      </button>
      <p id="lkm-embed-help" className="lkm-help">
        {embeddingsHelp(on, runs)}
      </p>
    </div>
  );
}

/** Export to a file you keep, import one back, or forget everything (asked once more first). */
export function MemoryFileActions({ busy, act, importFile, empty }: Act & { importFile: (file: File) => void; empty: boolean }) {
  const [asking, setAsking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const forgetAll = asking ? (
    <span className="lkm-confirm" role="group" aria-label="Forget everything?">
      <span>Forget everything Line remembered for this project?</span>
      <button type="button" className="lkm-forget" onClick={() => { setAsking(false); act({ kind: 'forgetAll' }); }} disabled={busy}>
        Yes, forget everything
      </button>
      <button type="button" onClick={() => setAsking(false)}>
        Keep it
      </button>
    </span>
  ) : (
    <button type="button" className="lkm-forget" onClick={() => setAsking(true)} disabled={busy || empty}>
      Forget everything
    </button>
  );
  return (
    <div className="lkm-files">
      <button type="button" onClick={() => act({ kind: 'export' })} disabled={busy || empty}>
        Export to a file
      </button>
      <button type="button" onClick={() => input.current?.click()} disabled={busy}>
        Import a file
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="lkm-file"
        aria-label="Import a Line memory file"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importFile(f);
          e.target.value = '';
        }}
      />
      {forgetAll}
    </div>
  );
}

import type { ReactNode } from 'react';
import { OllamaStatusPanel } from '../components/OllamaStatusPanel';
import { InstallGuidance } from '../components/InstallGuidance';
import { ModelList } from '../components/ModelList';
import { PullForm } from '../components/PullForm';
import type { useOllama } from '../hooks/useOllama';

type OllamaPageProps = ReturnType<typeof useOllama>;

export function OllamaPage({
  status, models, loadError, pullName, setPullName, pulling, pullProgress, pullPercent, pullError, pull, remove, installCommand,
}: OllamaPageProps): ReactNode {
  if (!status) return <p>Checking for Ollama…</p>;

  return (
    <div className="page">
      <h1>Local model (Ollama)</h1>
      <p className="hint">
        Construct can route small, scoped &quot;execution&quot; LLM calls (import&apos;s per-file fill,
        create/generate&apos;s optional fill) to a local Qwen Coder model via Ollama instead of Claude —
        see Settings to choose which capability uses which provider. Whole-feature planning/analysis
        calls always stay on Claude.
      </p>

      <OllamaStatusPanel running={status.running} version={status.version} host={status.host} />

      {!status.running && <InstallGuidance installCommand={installCommand} />}

      {status.running && (
        <>
          {loadError && <p className="status-error">{loadError}</p>}
          <ModelList models={models} onRemove={remove} />
          <PullForm
            pullName={pullName}
            setPullName={setPullName}
            pulling={pulling}
            pullStatus={pullProgress?.status ?? null}
            pullPercent={pullPercent}
            pullError={pullError}
            onPull={pull}
          />
        </>
      )}
    </div>
  );
}

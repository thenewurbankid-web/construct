import type { ReactNode } from 'react';
import { ErrorState, LoadingState, OfflineState } from '@/features/states';
import { OllamaStatusPanel } from '../components/OllamaStatusPanel';
import { InstallGuidance } from '../components/InstallGuidance';
import { ModelList } from '../components/ModelList';
import { PullForm } from '../components/PullForm';
import { ModelPicker } from '../components/ModelPicker';
import type { useOllama } from '../hooks/useOllama';

type OllamaPageProps = ReturnType<typeof useOllama>;

export function OllamaPage({
  status, statusError, refresh, models, loadError, pullName, setPullName, pulling, pullProgress, pullPercent, pullError, pull, remove, installCommand,
  qwenTags, selectedModel, selectModel,
}: OllamaPageProps): ReactNode {
  if (!status) {
    return (
      <div className="page page--screen">
        {statusError ? (
          <ErrorState title="Could not check for Ollama" hint={statusError} onRetry={refresh} />
        ) : (
          <LoadingState label="Checking for Ollama" hint="Asking the backend whether a local model server is running." />
        )}
      </div>
    );
  }

  return (
    <div className="page page--screen">
      <h1>Local model (Ollama)</h1>
      <p className="hint">
        Construct can route small, scoped &quot;execution&quot; LLM calls (import&apos;s per-file fill,
        create/generate&apos;s optional fill) to a local Qwen Coder model via Ollama instead of Claude —
        see Settings to choose which capability uses which provider. Whole-feature planning/analysis
        calls always stay on Claude.
      </p>

      <OllamaStatusPanel running={status.running} version={status.version} host={status.host} />

      {!status.running && <OfflineState size="inline" actions={[]} />}
      {!status.running && <InstallGuidance installCommand={installCommand} />}

      <ModelPicker tags={qwenTags} selectedModel={selectedModel} onSelect={selectModel} />

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
            recommended={qwenTags.map((t) => ({ tag: t.tag, label: `${t.label} (${t.approxSize})${t.recommended ? ' — recommended' : ''}` }))}
          />
        </>
      )}
    </div>
  );
}

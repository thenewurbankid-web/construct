import type { ReactNode } from 'react';
import { ErrorState } from '@/features/states';
import { ChatLog } from '../components/ChatLog';
import { WizardAnswerForm } from '../components/WizardAnswerForm';
import { WizardStartPanel } from '../components/WizardStartPanel';
import type { useWizard } from '../hooks/useWizard';

type WizardPageProps = ReturnType<typeof useWizard>;

export function WizardPage({ messages, status, awaitingAnswer, input, setInput, seedRoute, setSeedRoute, start, submitAnswer }: WizardPageProps): ReactNode {
  return (
    <div className="page page--screen">
      <h1>Import Route Wizard</h1>
      <p className="hint">
        Guides a whole-feature import: traces a route&apos;s real import graph, proposes a plan with
        one combined LLM call, and only writes anything once you approve it. Each browser tab runs
        its own independent session.
      </p>

      {(status === 'idle' || status === 'done') && (
        <WizardStartPanel seedRoute={seedRoute} setSeedRoute={setSeedRoute} onStart={start} />
      )}

      <ChatLog messages={messages} />

      {awaitingAnswer && <WizardAnswerForm input={input} setInput={setInput} onSubmit={submitAnswer} />}

      {status === 'closed' && (
        <ErrorState
          size="inline"
          title="Disconnected from the backend"
          hint="The wizard session ended because the backend connection closed. Start the backend, then start a new session."
        />
      )}
    </div>
  );
}

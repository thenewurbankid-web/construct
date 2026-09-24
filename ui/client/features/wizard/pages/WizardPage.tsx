import type { ReactNode } from 'react';
import { ErrorState, LoadingState } from '@/features/states';
import { ChatLog } from '../components/ChatLog';
import { StepTracker } from '../components/StepTracker';
import { WizardAnswerForm } from '../components/WizardAnswerForm';
import { WizardStartPanel } from '../components/WizardStartPanel';
import type { useWizard } from '../hooks/useWizard';

type WizardPageProps = ReturnType<typeof useWizard>;

export function WizardPage({ messages, status, awaitingAnswer, steps, cancelling, cancel, input, setInput, seedRoute, setSeedRoute, planner, setPlanner, start, submitAnswer }: WizardPageProps): ReactNode {
  return (
    <div className="page page--screen">
      <h1>Import Route Wizard</h1>
      <p className="hint">
        Guides a whole-feature import: traces a route&apos;s real import graph, proposes a plan (one model call,
        or mechanically from the code), and only writes anything once you approve it. Each browser tab runs
        its own independent session.
      </p>

      {(status === 'idle' || status === 'done') && (
        <WizardStartPanel seedRoute={seedRoute} setSeedRoute={setSeedRoute} planner={planner} setPlanner={setPlanner} onStart={start} />
      )}

      {status === 'connecting' && messages.length === 0 && (
        <LoadingState size="inline" label="Connecting to the wizard" hint="Opening a session with the backend." />
      )}

      <div className="wizard-layout">
        <div className="wizard-layout__main">
          <ChatLog messages={messages} />

          {awaitingAnswer && <WizardAnswerForm input={input} setInput={setInput} onSubmit={submitAnswer} />}
        </div>
        <StepTracker steps={steps} running={status === 'running'} cancelling={cancelling} onCancel={cancel} />
      </div>

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

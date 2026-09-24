import { ApproveBar } from '../components/ApproveBar';
import { CardPanel } from '../components/CardPanel';
import { OpenQuestions } from '../components/OpenQuestions';
import { PlacementPanel } from '../components/PlacementPanel';
import { ProofCard } from '../components/ProofCard';
import { SentenceForm } from '../components/SentenceForm';
import { ShapeOffer } from '../components/ShapeOffer';
import { TimelinePanel } from '../components/TimelinePanel';
import type { RequirementPageProps } from '../types';

// Presentation-only: the stage of the Requirement screen, in reading order. A sentence goes in; the card, the open
// questions, the placement, the timeline and the approval come out, each drawn from what the server returned.
export function RequirementPage({ view, onText, onExample, onRead, onAnswer, onApprove, onSaveNote, onOpenProcesses, onProofRun, onProofSkipOpen, onProofSkipDraft, onProofSkipConfirm, onProofSkipCancel }: RequirementPageProps) {
  const { result } = view;
  return (
    <div className="rq-stage" data-testid="requirement-stage">
      <div className="rq-toolbar">
        <h1 className="rq-h1">Requirement</h1>
        <p className="rq-lede">From a plain-English sentence to a plan you approve. The chain is read back as a card, a placement and a timeline before anything is written.</p>
      </div>
      <SentenceForm view={view} onText={onText} onExample={onExample} onRead={onRead} />
      {result && <CardPanel card={result.card} />}
      {result && result.open.length > 0 && <OpenQuestions open={result.open} busy={view.busy} onAnswer={onAnswer} />}
      {result && result.blocks && <PlacementPanel blocks={result.blocks} notes={result.notes} errors={result.errors} />}
      {result && result.offers.length > 0 && <ShapeOffer offers={result.offers} busy={view.busy} onAnswer={onAnswer} />}
      {result && result.timeline.length > 0 && <TimelinePanel steps={result.timeline} />}
      {result && <ApproveBar approve={result.approve} warnings={result.warnings} files={result.files} onApprove={onApprove} onSaveNote={onSaveNote} onOpenProcesses={onOpenProcesses} />}
      {result && result.proof && <ProofCard proof={result.proof} onRun={onProofRun} onSkipOpen={onProofSkipOpen} onSkipDraft={onProofSkipDraft} onSkipConfirm={onProofSkipConfirm} onSkipCancel={onProofSkipCancel} />}
    </div>
  );
}

import { TrainError } from '../components/TrainError';
import { ReviewQueue } from '../components/ReviewQueue';
import { TeachPanel } from '../components/TeachPanel';
import { ScoreboardPanel } from '../components/ScoreboardPanel';
import { DomainMapDetails } from '../components/DomainMapDetails';
import '../components/line-train.css';
import type { TrainScreen } from '../types';

/** Train Line: where the owner and Claude teach Line's drafter on the solid Line tools. Review Claude's cases, teach a
 * request, read the scoreboard. Plain English first; tool calls and slots sit under Details. */
export function LineTrainPage({ screen }: { screen: TrainScreen }) {
  return (
    <div className="ltr" data-testid="line-train" aria-busy={screen.busy}>
      <h1>Train Line</h1>
      <p className="ltr-lead">
        Teach Line how to turn a request into steps and checks, using only its tested tools. Every check runs in a scratch copy of an
        imaginary or sample project, never in your own project.
      </p>
      <TrainError sentence={screen.error} />
      <ReviewQueue queue={screen.queue} />
      <TeachPanel teach={screen.teach} />
      <ScoreboardPanel score={screen.score} />
      <DomainMapDetails map={screen.map} />
    </div>
  );
}

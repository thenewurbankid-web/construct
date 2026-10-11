import type { ScoreLine } from '../types';

type Score = { lines: ScoreLine[]; intents: ScoreLine[]; sentence: string; lastRun: string; run: () => void; running: boolean };

const row = (l: ScoreLine) => (
  <tr key={l.key}>
    <th scope="row">{l.label}</th>
    <td>{l.cases}</td>
    <td>{l.heldout}</td>
    <td>{l.recall}</td>
    <td>{l.precision}</td>
    <td>{l.preferred}</td>
    <td>{l.noRepair}</td>
    <td>{l.agreement}</td>
  </tr>
);

/** One scoreboard table (per tool family, or per kind of request). */
function ScoreTable({ caption, first, lines, testId }: { caption: string; first: string; lines: ScoreLine[]; testId: string }) {
  return (
    <div className="ltr-table-wrap">
      <table className="ltr-table" data-testid={testId}>
        <caption className="ltr-meta">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{first}</th>
            <th scope="col">Cases</th>
            <th scope="col">Held out</th>
            <th scope="col">Valid routes found</th>
            <th scope="col">Drafted routes valid</th>
            <th scope="col">Preferred picked</th>
            <th scope="col">Passed with no repair</th>
            <th scope="col">Your agreement</th>
          </tr>
        </thead>
        <tbody>{lines.map(row)}</tbody>
      </table>
    </div>
  );
}

/** The scoreboard: how well the drafter does on whole projects it never learned from, and how often you agree with
 * Claude's cases. "Run eval" drafts every held-out case again. */
export function ScoreboardPanel({ score }: { score: Score }) {
  return (
    <section className="ltr-section" aria-labelledby="ltr-score-head" data-testid="train-scoreboard">
      <h2 id="ltr-score-head">
        Scoreboard <small data-testid="train-last-run">{score.lastRun}</small>
      </h2>
      <p className="ltr-lead" data-testid="train-score-sentence">{score.sentence}</p>
      <span className="ltr-actions">
        <button type="button" className="ltr-btn ltr-btn--primary" onClick={score.run} disabled={score.running}>Run eval</button>
      </span>
      <ScoreTable caption="By tool family" first="Tool family" lines={score.lines} testId="train-score-family" />
      <details className="ltr-tech">
        <summary>By kind of request</summary>
        <ScoreTable caption="By kind of request" first="Kind of request" lines={score.intents} testId="train-score-intent" />
      </details>
    </section>
  );
}

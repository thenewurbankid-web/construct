'use client';

import { useState } from 'react';
import { RouteCard } from './RouteCard';
import type { CaseView, ReviewControls, RouteCardView } from '../types';

const route = (card: RouteCardView) => <RouteCard key={card.id} card={card} />;

/** Agree, or Disagree with an optional note (one click to open the note, one to send). */
function ReviewButtons({ c, review }: { c: CaseView; review: ReviewControls }) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  if (!c.canReview) return <p className="ltr-meta" data-testid="train-case-status">{c.statusLine}</p>;
  if (noting) {
    return (
      <div className="ltr-note">
        <label htmlFor={`note-${c.id}`}>What is wrong with it? (optional)</label>
        <textarea id={`note-${c.id}`} value={note} onChange={(e) => setNote(e.target.value)} />
        <span className="ltr-actions">
          <button type="button" className="ltr-btn ltr-btn--primary" disabled={review.busy} onClick={() => review.disagree(c.id, note)}>Send disagreement</button>
          <button type="button" className="ltr-btn" onClick={() => setNoting(false)}>Cancel</button>
        </span>
      </div>
    );
  }
  return (
    <span className="ltr-actions">
      <button type="button" className="ltr-btn ltr-btn--primary" disabled={review.busy} onClick={() => review.agree(c.id)}>Agree</button>
      <button type="button" className="ltr-btn" disabled={review.busy} onClick={() => setNoting(true)}>Disagree</button>
    </span>
  );
}

/** A case that no longer fits its world says so. */
function Problem({ text }: { text: string }) {
  if (!text) return null;
  return <p className="ltr-error">{text}</p>;
}

/** One of Claude's proposed cases: the request with names filled in, what kind of request it is, every valid route
 * side by side (the preferred one starred), and Agree / Disagree. The stored, slotted form sits under Details. */
export function CaseCard({ c, review }: { c: CaseView; review: ReviewControls }) {
  return (
    <li className="ltr-case" data-testid="train-case" data-status={c.status} aria-label={`Case: ${c.request}`}>
      <p className="ltr-by">{c.by}</p>
      <h3>{c.request}</h3>
      <p className="ltr-meta">{c.intent}. In {c.world}.</p>
      <Problem text={c.problem} />
      <div className="ltr-routes">{c.cards.map(route)}</div>
      <ReviewButtons c={c} review={review} />
      <details className="ltr-tech">
        <summary>Details</summary>
        <code>{c.slotted}</code>
        <code>{`${c.intentId}, ${c.split}, ${c.id}`}</code>
      </details>
    </li>
  );
}

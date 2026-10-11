import type { ReactNode } from 'react';
import type { PlainDetail } from './lineContract';
import './plain-first.css';

type PlainFirstProps = {
  /** Plain-English sentences (the summarizer's, packages/summarize), shown first. */
  sentences: string[];
  /** The technical part (tool call, code, ids, options with confidence, the reasoning), collapsed under Details. */
  details: PlainDetail[];
  sentenceTestId?: string;
  sentenceClassName?: string;
  detailsClassName?: string;
  /** Plain parts that sit between the sentences and Details (what is already there, the person's choices). */
  children?: ReactNode;
};

/** cs1: every message shows its plain-English text first, with the technical part in a collapsed Details under it. */
export function PlainFirst({ sentences, details, sentenceTestId, sentenceClassName, detailsClassName, children }: PlainFirstProps) {
  return (
    <>
      <p className={sentenceClassName ?? 'pf-sentence'} data-testid={sentenceTestId} data-plain-first="">
        {sentences.join(' ')}
      </p>
      {children}
      {details.length > 0 && (
        <details className={detailsClassName ?? 'pf-tech'} data-testid="plain-first-details">
          <summary>Details</summary>
          <dl className="pf-list">
            {details.map((d, i) => (
              <div key={`${d.label}-${i}`} className="pf-row">
                <dt>{d.label}</dt>
                <dd>
                  <code data-testid={d.testId}>{d.text}</code>
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </>
  );
}

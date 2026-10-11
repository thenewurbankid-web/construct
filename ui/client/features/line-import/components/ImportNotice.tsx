import type { ImportApplyResult } from '../types';
import { TechDetails } from './TechDetails';

function Landed({ result }: { result: ImportApplyResult }) {
  return (
    <div className="li-notice" data-testid="li-notice">
      <p>{result.sentence}</p>
      <TechDetails summary="Details" lines={result.files} />
    </div>
  );
}

function Refused({ sentence, result }: { sentence: string; result: ImportApplyResult | null }) {
  const lines = (result?.findings ?? []).map((f) => `${f.rule} ${f.file}:${f.line}`);
  return (
    <div className="li-notice li-notice--error" data-testid="li-error">
      <p>{sentence}</p>
      <TechDetails summary="Details" lines={lines} />
    </div>
  );
}

/** The outcome of Apply, or the sentence of the last refused call; always rendered as a live region. */
export function ImportNotice({ result, error }: { result: ImportApplyResult | null; error: string | null }) {
  const landed = result?.ok ? result : null;
  return (
    <div className="li-notice-slot" role="status" aria-live="polite">
      {landed && <Landed result={landed} />}
      {error && <Refused sentence={error} result={result} />}
    </div>
  );
}

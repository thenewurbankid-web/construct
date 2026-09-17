import type { StatusMessage } from '../types';

export function SaveStatus({ status }: { status: StatusMessage }) {
  return (
    <div className={status.ok ? 'status-ok' : 'status-error'}>
      <p>{status.message}</p>
      {status.violations && status.violations.length > 0 && (
        <ul className="violation-list">
          {status.violations.map((v, i) => (
            <li key={i}>
              <strong>{v.rule}</strong> ({v.severity}): {v.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

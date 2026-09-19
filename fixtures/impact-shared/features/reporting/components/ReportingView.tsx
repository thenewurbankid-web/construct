import { CurrencyLabel } from '../../shared/index';

type ReportingViewProps = { total: number; onStart: () => void };

export function ReportingView({ total, onStart }: ReportingViewProps) {
  return (
    <section>
      <CurrencyLabel value={{ amount: total, currency: 'USD' }} />
      <button onClick={onStart}>Reporting</button>
    </section>
  );
}

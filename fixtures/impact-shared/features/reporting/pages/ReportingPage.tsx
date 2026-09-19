import { ReportingView } from '../components/ReportingView';

type ReportingPageProps = { total: number; onStart: () => void };

export function ReportingPage({ total, onStart }: ReportingPageProps) {
  return <ReportingView total={total} onStart={onStart} />;
}

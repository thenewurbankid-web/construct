import { Pill } from '../components/Pill';

export function TablePage({ heading, onRefresh }: { heading: string; onRefresh?: () => void }) {
  return (
    <main>
      <h1>{heading}</h1>
      <Pill text="Live" />
      <button type="button" onClick={onRefresh}>Refresh</button>
    </main>
  );
}

import { Button } from '../components/Button';

export function ListPage({ title, onMore }: { title: string; onMore?: () => void }) {
  return (
    <main>
      <h1>{title}</h1>
      <Button label="More" />
      <button type="button" onClick={onMore}>Show more</button>
    </main>
  );
}

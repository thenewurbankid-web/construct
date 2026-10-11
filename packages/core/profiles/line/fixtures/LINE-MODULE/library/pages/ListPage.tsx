import { Button } from '../components/Button';

export function ListPage({ title }: { title: string }) {
  return (
    <main>
      <h1>{title}</h1>
      <Button label="More" />
    </main>
  );
}

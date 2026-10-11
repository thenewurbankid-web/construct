import { Button } from './Button';

export function Card({ title, action }: { title: string; action: string }) {
  return (
    <section>
      <h2>{title}</h2>
      <Button label={action} />
    </section>
  );
}

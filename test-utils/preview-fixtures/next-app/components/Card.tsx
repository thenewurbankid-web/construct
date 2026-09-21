'use client';

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section data-testid="card">
      <h2>{title}</h2>
      <div className="card-body">{children}</div>
    </section>
  );
}

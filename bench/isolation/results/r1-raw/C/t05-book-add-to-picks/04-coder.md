```tsx
import type { ReactNode } from 'react';

export type DetailPageProps = {
  title: string;
  /** A link back, shown above the title. */
  back?: ReactNode;
  children?: ReactNode;
  /** Actions beside the content (price, add to cart). */
  aside?: ReactNode;
};

export function DetailPage({ title, back, children, aside }: DetailPageProps) {
  return (
    <main className="flex flex-col gap-4">
      {back}
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <section className="flex flex-col gap-3">{children}</section>
        {aside ? <aside className="flex flex-col gap-3">{aside}</aside> : null}
      </div>
    </main>
  );
}
```
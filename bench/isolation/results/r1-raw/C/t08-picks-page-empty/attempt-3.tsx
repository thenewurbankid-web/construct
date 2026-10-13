import type { ReactNode } from 'react';

export type ListPageProps = {
  title: string;
  /** Filters and search above the list. */
  toolbar?: ReactNode;
  /** The items, laid out as a grid. */
  children?: ReactNode;
  /** Shown instead of the grid when there is nothing to list. */
  empty?: ReactNode;
};

export function ListPage({ title, toolbar, children, empty }: ListPageProps) {
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">My picks</h1>
      {toolbar ? <div className="flex flex-wrap items-end gap-4">{toolbar}</div> : null}
      {children ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div> : empty}
    </main>
  );
}

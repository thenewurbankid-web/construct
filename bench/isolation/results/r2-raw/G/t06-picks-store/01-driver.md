```ts
import { useEffect, useState } from 'react';

// Picks store: the member's picked book ids, kept in localStorage under the key "picks".
export const listPicks = (): string[] => {
  const picks = localStorage.getItem('picks');
  return picks ? JSON.parse(picks) : [];
};

export const addPick = (id: string): void => {
  const picks = listPicks();
  if (!picks.includes(id)) {
    picks.push(id);
    localStorage.setItem('picks', JSON.stringify(picks));
  }
};

export const removePick = (id: string): void => {
  const picks = listPicks();
  const index = picks.indexOf(id);
  if (index !== -1) {
    picks.splice(index, 1);
    localStorage.setItem('picks', JSON.stringify(picks));
  }
};
```
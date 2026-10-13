Implement the picks store with the required functions. Store the book IDs in localStorage under the key "picks" as a JSON array of strings. Here's how to do it:

1. Import the necessary modules.
2. Define the `listPicks` function to return the picked book IDs.
3. Define the `addPick` function to add a book ID to the list.
4. Define the `removePick` function to remove a book ID from the list.

Example code:
```ts
import { useState, useEffect } from 'react';

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
```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { useState } from 'react';
import { pickedBooks, type Book } from '../services/pickedBooks';
import { listPicks, addPick, removePick } from '../store/picksStore';
import { Button } from '../../../library/components/Button';

type Pick = Book & {
  index: number;
};

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());
  const items = pickedBooks({ ids });
  const [pickedBookIndices, setPickedBookIndices] = useState<number[]>(() => ids.map(() => Math.random() * items.length));

  const handleRemovePick = (index: number) => {
    removePick(ids[index]);
    setIds(listPicks());
    setPickedBookIndices((prevIndices) =>
      prevIndices.filter((prevIndex, i) => i !== index)
    );
  };

  return (
    <ListPage title="My picks" empty={<p>Your picks are empty</p>}>
      {pickedBookIndices.length > 0 && pickedBookIndices.map((index, i) => {
        const book = items[index];
        return (
          <article key={book.id}>
            <h2>{book.title}</h2>
            <p>{book.author}</p>
            <Button
              label={`Remove ${book.title}`}
              onClick={() => handleRemovePick(index)}
            />
          </article>
        );
      })}
    </ListPage>
  );
}
```
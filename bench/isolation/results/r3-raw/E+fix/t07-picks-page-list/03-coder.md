```tsx
// @line-base pages/ListPage
// @line-route /picks
import { ListPage } from '../../../library/pages/ListPage';

export function PicksPage() {
  const [picks, setPicks] = useState(listPicks());

  const handleRemovePick = (id: string) => {
    removePick(id);
    setPicks(listPicks());
  };

  return (
    <ListPage title="Picks">
      {picks.map((id) => {
        const book = books.find((b) => b.id === id);
        if (!book) return null;
        return (
          <div key={id} className="flex items-center justify-between">
            <div>{`${book.title} by ${book.author}`}</div>
            <Button label="Remove" onClick={() => handleRemovePick(id)} />
          </div>
        );
      })}
    </ListPage>
  );
}
```
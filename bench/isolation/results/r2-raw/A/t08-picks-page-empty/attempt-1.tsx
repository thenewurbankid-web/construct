import { ListPage } from '../../../library/pages/ListPage';

export function PicksPage() {
  const picks = listPicks();
  if (picks.length === 0) {
    return (
      <ListPage title="Picks">
        <div className="text-center text-lg font-bold">You have not picked any books yet</div>
      </ListPage>
    );
  }
  return <ListPage title="Picks">{/* Your existing list items here */}</ListPage>;
}

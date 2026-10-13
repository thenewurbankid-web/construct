import { ListPage } from '../../../library/pages/ListPage';
import { listPicks } from '../store/picksStore';

export function PicksPage() {
  const picks = listPicks();
  const emptyText = picks.length === 0 ? 'You have not picked any books yet' : undefined;

  return (
    <ListPage
      title="My picks"
      empty={emptyText}
    />
  );
}

import { ListPage } from '../../../library/pages/ListPage';
import { listPicks, removePick } from '../../../features/picks/store/picksStore';

export function PicksPage() {
  const picks = listPicks();

  const handleRemovePick = (id: string) => {
    removePick(id);
  };

  return (
    <ListPage title="Picks">
      {picks.map((id) => (
        <div key={id}>
          <h2>{id}</h2>
          <Button onClick={() => handleRemovePick(id)}>Remove {id}</Button>
        </div>
      ))}
    </ListPage>
  );
}

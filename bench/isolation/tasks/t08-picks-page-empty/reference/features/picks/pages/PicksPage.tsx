'use client';
// @line-base pages/ListPage
// @line-route /picks
import { useState } from 'react';
import { ListPage } from '../../../library/pages/ListPage';
import { listPicks } from '../store/picksStore';

export function PicksPage() {
  const [picks, setPicks] = useState<string[]>(() => listPicks());
  void setPicks;
  return (
    <ListPage title="My picks" empty={<p>You have not picked any books yet</p>}>
      {picks.length > 0 && picks.map((id) => <p key={id}>{id}</p>)}
    </ListPage>
  );
}

import { useState } from 'react';

export function Page001() {
  const [open, setOpen] = useState(false);
  return <div onClick={() => setOpen(!open)}>Page001</div>;
}

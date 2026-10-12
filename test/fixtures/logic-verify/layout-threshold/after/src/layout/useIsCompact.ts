import { useEffect, useState } from 'react';

export function useIsCompact(): boolean {
  const [compact, setCompact] = useState(() => window.innerWidth < 640);
  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return compact;
}

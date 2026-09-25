// HOOK-003 (off by default): the listener is added and never removed, so it outlives the hook
// and keeps calling setWidth after the component that owned it is gone.
import { useEffect, useState } from 'react';

export function useViewport() {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
  }, []);
  return { width };
}

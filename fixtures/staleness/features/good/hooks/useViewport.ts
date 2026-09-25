// The subscription dies with the hook: the effect returns the function that stops it.
import { useEffect, useState } from 'react';

export function useViewport() {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize, { signal: controller.signal });
    return () => controller.abort();
  }, []);
  return { width };
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Measures the box the preview iframe fills, live. A callback ref, because the
 * box is mounted and unmounted as the preview connects, disconnects and goes
 * full screen — each time we re-observe whatever is now there. This is what
 * makes the size readout honest: "1280" in a 900px stage reads 900. */
export function usePreviewMeasure() {
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const observer = useRef<ResizeObserver | null>(null);

  const boxRef = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof ResizeObserver === 'undefined') {
      setMeasured(null);
      return;
    }
    const read = () => setMeasured({ width: node.clientWidth, height: node.clientHeight });
    read();
    observer.current = new ResizeObserver(read);
    observer.current.observe(node);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return { boxRef, measured };
}

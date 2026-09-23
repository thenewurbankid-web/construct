/** Editor state for the canvas: type-checks cleanly. */
export function useCanvasEditor(initialZoom: number): { zoom: number } {
  const zoom: number = initialZoom;
  return { zoom };
}

/** Editor state for the canvas: an LLM fill that forgot its React imports (#579). */
export function useCanvasEditor() {
  const canvasRef = useRef(null);
  return { canvasRef };
}

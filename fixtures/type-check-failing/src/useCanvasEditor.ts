/** Editor state for the canvas: an LLM fill that forgot its React imports (#495 / #490). */
export function useCanvasEditor() {
  const canvasRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  return { canvasRef, zoom, setZoom };
}

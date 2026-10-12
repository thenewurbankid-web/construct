// Mission Control's Beam eval panel, browser side (#902). Mounts Trace's planner eval UI (trace/src/ui/beam.mjs,
// served at /beam-eval/ui/beam.mjs) into #beam-eval-root and feeds it the live run trees from /beam-eval/events.
// Same SSE convention as index.html: on('<type>', fn).
import { mountBeam } from '/beam-eval/ui/beam.mjs';

const root = document.getElementById('beam-eval-root');
const style = document.createElement('style');
style.textContent = `
#beam-eval-root { padding: 6px 8px; font-size: 12px; }
#beam-eval-root .summary { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
#beam-eval-root .stat { background: var(--panel2); border: 1px solid var(--line); border-radius: 3px; padding: 4px 8px; display: flex; flex-direction: column; min-width: 120px; }
#beam-eval-root .stat.warn b { color: #f0b429; }
#beam-eval-root .k, #beam-eval-root .sub { color: var(--dim); font-size: 11px; }
#beam-eval-root .setupbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 6px; }
#beam-eval-root .cols { display: grid; grid-template-columns: minmax(200px, 1fr) 3fr; gap: 8px; }
#beam-eval-root ol.items { list-style: none; margin: 0; padding: 0; max-height: 70vh; overflow: auto; }
#beam-eval-root button.item { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; background: var(--panel2); border: 1px solid var(--line); border-radius: 3px; margin-bottom: 4px; padding: 4px 6px; cursor: pointer; color: inherit; }
#beam-eval-root button.item.sel { border-color: #3b82f6; }
#beam-eval-root .chip { border: 1px solid var(--line2); border-radius: 8px; padding: 0 6px; font-size: 10px; margin-left: 4px; }
#beam-eval-root .chip.ok { color: #3fb950; } #beam-eval-root .chip.warn { color: #f0b429; } #beam-eval-root .chip.mut { color: var(--dim); }
#beam-eval-root .detail { max-height: 70vh; overflow: auto; }
#beam-eval-root h2, #beam-eval-root h3 { font-size: 12px; margin: 8px 0 3px; }
#beam-eval-root .tree ul { list-style: none; margin: 2px 0; padding-left: 14px; border-left: 1px solid var(--line2); }
#beam-eval-root .tree li[data-status=closed] { opacity: .7; }
#beam-eval-root ol.path { margin: 2px 0; padding-left: 18px; }
#beam-eval-root .path .layer { color: var(--dim); margin-right: 6px; }
#beam-eval-root .path .dec { margin-left: 6px; font-size: 10px; border: 1px solid var(--line2); border-radius: 3px; padding: 0 4px; }
#beam-eval-root table { border-collapse: collapse; margin: 4px 0 8px; }
#beam-eval-root td, #beam-eval-root th { padding: 2px 6px; border-bottom: 1px solid var(--line); position: static; }
#beam-eval-root .sbtn[aria-pressed=true] { background: #1f6feb; color: #fff; }
#beam-eval-root .rline { display: flex; gap: 8px; align-items: center; margin: 2px 0; }
#beam-eval-root textarea { width: 100%; background: var(--panel2); color: inherit; border: 1px solid var(--line2); }
#beam-eval-root .warn td { color: #f0b429; }
`;
document.head.appendChild(style);

const api = mountBeam(root);
const es = new EventSource('/beam-eval/events');
const on = (type, fn) => es.addEventListener(type, (e) => { try { fn(JSON.parse(e.data)); } catch { /* bad frame */ } });
const sub = document.getElementById('beamEvalSub');
on('beam-trees', (list) => { for (const t of list) api.setLiveTree(t.setup, t.item, t.tree); });
on('beam-tree', (t) => { api.setLiveTree(t.setup, t.item, t.tree); if (sub) sub.textContent = `live: ${t.setup} / ${t.item} · ${t.tree.runs.length} run(s), ${t.tree.closed} closed${t.tree.done ? `, ${t.tree.done.outcome}` : ''}`; });
on('beam-results', () => api.reload());

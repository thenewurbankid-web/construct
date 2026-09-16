import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { GlassPanel, Select } from '../components/ui/index.js';

// Epic #48 in one page (like Dashboard.jsx holds four independent forms —
// this holds the pages browser, JSX tree, live-preview mirror, snippet
// editor, props inspector, auto-mapper, and prop-flow diagram, each a
// separate sub-issue but sharing one selected-node/tree state machine).
//
// #51 note (decision point, also posted to the issue): the "live preview"
// here is a *structural* re-render of the same parsed tree #50 produced —
// each JSX element becomes a labeled box nested to match the real markup —
// not an execution of the actual page component. Actually mounting an
// arbitrary feature's page component would mean bundling its real imports,
// hooks, context providers, and app-specific runtime state inside this
// admin tool, which is a much larger (and riskier) undertaking than a
// click-through editor needs; the structural mirror still gives exact
// bidirectional selection between "this tree node" and "this rendered
// element" (both directions), which is what #51 actually asks for.

function findNode(roots, id) {
  for (const r of roots) {
    if (r.id === id) return r;
    const hit = findNode(r.children, id);
    if (hit) return hit;
  }
  return null;
}

function flattenParentOf(roots) {
  const parentOf = new Map();
  const walk = (nodes, parent) => {
    for (const n of nodes) {
      parentOf.set(n.id, parent);
      walk(n.children, n);
    }
  };
  walk(roots, null);
  return parentOf;
}

function propLabel(p) {
  if (p.kind === 'spread') return `{...${p.value}}`;
  if (p.kind === 'boolean' && p.value === true) return p.name;
  if (p.kind === 'string') return `${p.name}="${p.value}"`;
  return `${p.name}={${p.value}}`;
}

// ---------------------------------------------------------------------------
// #49 — pages browser
// ---------------------------------------------------------------------------
function PagesBrowser({ feature, onFeatureChange, features, file, onOpen, files, loading }) {
  return (
    <GlassPanel className="pages-browser">
      <label className="field">
        <span>Feature</span>
        <Select value={feature} onChange={(e) => onFeatureChange(e.target.value)}>
          <option value="">— select a feature —</option>
          {features.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </Select>
      </label>
      {feature && (
        <div>
          <h4>pages/ in "{feature}"</h4>
          {loading ? (
            <p className="hint">Loading…</p>
          ) : files.length === 0 ? (
            <p className="hint">No files under features/{feature}/pages/.</p>
          ) : (
            <ul className="pages-file-list">
              {files.map((f) => (
                <li key={f} className={f === file ? 'active' : ''}>
                  <button type="button" onClick={() => onOpen(f)}>
                    {f}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </GlassPanel>
  );
}

// ---------------------------------------------------------------------------
// #50 — JSX tree view / #51 — bidirectional tree <-> preview selection
// ---------------------------------------------------------------------------
function TreeNode({ node, selectedId, onSelect, depth }) {
  const isSelected = node.id === selectedId;
  return (
    <li>
      <div
        className={`tree-node${isSelected ? ' selected' : ''}${node.isCustomComponent ? ' component' : ''}`}
        style={{ paddingLeft: `${depth * 14}px` }}
        onClick={() => onSelect(node.id)}
      >
        <span className="tree-node-tag">{node.isFragment ? '<>' : `<${node.tag}>`}</span>
        {node.props.length > 0 && <span className="tree-node-props"> {node.props.length} prop{node.props.length === 1 ? '' : 's'}</span>}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function TreePanel({ roots, selectedId, onSelect }) {
  return (
    <GlassPanel className="tree-panel">
      <h4>JSX tree</h4>
      <ul className="tree-root">
        {roots.map((r) => (
          <TreeNode key={r.id} node={r} selectedId={selectedId} onSelect={onSelect} depth={0} />
        ))}
      </ul>
    </GlassPanel>
  );
}

function PreviewNode({ node, selectedId, onSelect }) {
  const isSelected = node.id === selectedId;
  return (
    <div
      className={`preview-node${isSelected ? ' selected' : ''}${node.isCustomComponent ? ' component' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node.id);
      }}
      title={node.props.map(propLabel).join(' ')}
    >
      <div className="preview-node-label">{node.isFragment ? 'Fragment' : node.tag}</div>
      {node.children.length > 0 && (
        <div className="preview-node-children">
          {node.children.map((c) => (
            <PreviewNode key={c.id} node={c} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function PreviewPanel({ roots, selectedId, onSelect }) {
  return (
    <GlassPanel className="preview-panel">
      <h4>Live preview (structural mirror — see hint below)</h4>
      <p className="hint">
        Each box is one element from the same parse #50 produced. Click a box or a tree node — both
        select the same underlying node.
      </p>
      <div className="preview-canvas">
        {roots.map((r) => (
          <PreviewNode key={r.id} node={r} selectedId={selectedId} onSelect={onSelect} />
        ))}
      </div>
    </GlassPanel>
  );
}

// ---------------------------------------------------------------------------
// #52 — isolated snippet editor with save-back / #53 — props inspector /
// #54 — auto-map unmapped props
// ---------------------------------------------------------------------------
function SnippetEditor({ feature, file, nodeId, contentHash, onSaved }) {
  const [snippet, setSnippet] = useState('');
  const [loadedHash, setLoadedHash] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    setStatus(null);
    api.getNodeSnippet(feature, file, nodeId).then((r) => {
      setSnippet(r.snippet || '');
      setLoadedHash(r.contentHash);
    });
  }, [feature, file, nodeId, contentHash]);

  async function save() {
    setBusy(true);
    setStatus(null);
    const result = await api.saveNodeSnippet({ feature, file, nodeId, snippet, contentHash: loadedHash });
    setBusy(false);
    if (result.ok) {
      setStatus({ ok: true, message: 'Saved — patched back into the source file.' });
      onSaved(result);
    } else {
      setStatus({ ok: false, message: result.error, violations: result.violations });
    }
  }

  return (
    <div className="snippet-editor">
      <h4>Snippet ({nodeId}) — isolated to this node only</h4>
      <textarea
        className="snippet-textarea"
        value={snippet}
        onChange={(e) => setSnippet(e.target.value)}
        rows={Math.min(16, Math.max(4, snippet.split('\n').length + 1))}
        spellCheck={false}
      />
      <button type="button" onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save snippet'}
      </button>
      {status && <SaveStatus status={status} />}
    </div>
  );
}

function SaveStatus({ status }) {
  return (
    <div className={status.ok ? 'status-ok' : 'status-error'}>
      <p>{status.message}</p>
      {status.violations?.length > 0 && (
        <ul className="violation-list">
          {status.violations.map((v, i) => (
            <li key={i}>
              <strong>{v.rule}</strong> ({v.severity}): {v.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function propInputKind(p) {
  if (p.kind === 'string' || p.kind === 'number' || p.kind === 'boolean') return p.kind;
  return 'expression'; // identifier/expression both edited as raw code
}

function PropRow({ feature, file, nodeId, contentHash, prop, onSaved }) {
  const kind = propInputKind(prop);
  const [value, setValue] = useState(prop.kind === 'expression' || prop.kind === 'identifier' ? prop.value : prop.value);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  async function save() {
    setBusy(true);
    setStatus(null);
    const result = await api.saveNodeProp({ feature, file, nodeId, propName: prop.name, kind, value, contentHash });
    setBusy(false);
    if (result.ok) {
      setStatus({ ok: true, message: 'Saved.' });
      onSaved(result);
    } else {
      setStatus({ ok: false, message: result.error, violations: result.violations });
    }
  }

  return (
    <div className="prop-row">
      <span className="prop-name">{prop.name}</span>
      {kind === 'boolean' ? (
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => setValue(e.target.checked)} />
      ) : kind === 'number' ? (
        <input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} />
      ) : (
        <input type="text" value={value} onChange={(e) => setValue(e.target.value)} />
      )}
      <button type="button" onClick={save} disabled={busy}>
        {busy ? '…' : 'Save'}
      </button>
      {status && <SaveStatus status={status} />}
    </div>
  );
}

function AutoMapPanel({ feature, file, nodeId, contentHash, onSaved }) {
  const [candidates, setCandidates] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  async function find() {
    setStatus(null);
    const result = await api.getUnmappedProps(feature, file, nodeId);
    setCandidates(result.candidates || []);
    setChecked(new Set(result.candidates || []));
  }

  async function apply() {
    setBusy(true);
    setStatus(null);
    const result = await api.applyAutoMap({ feature, file, nodeId, propNames: [...checked], contentHash });
    setBusy(false);
    if (result.ok) {
      setStatus({ ok: true, message: `Wired ${checked.size} prop(s).` });
      setCandidates([]);
      onSaved(result);
    } else {
      setStatus({ ok: false, message: result.error, violations: result.violations });
    }
  }

  return (
    <div className="automap-panel">
      <h4>Auto-map unmapped props (#54)</h4>
      <p className="hint">
        Scope, as implemented: compares this component's JSX attributes against the enclosing page's
        own props (destructured function params) and <code>useState</code> names — any of those not
        currently passed down as a same-named attribute is offered as a shorthand{' '}
        <code>{'{name}'}</code> wire-up. This is single-file/heuristic — it does not resolve the
        child component's own declared prop types across files.
      </p>
      <button type="button" onClick={find}>
        Find unmapped props
      </button>
      {candidates && (
        <>
          {candidates.length === 0 ? (
            <p className="hint">Nothing unmapped.</p>
          ) : (
            <ul className="automap-candidates">
              {candidates.map((name) => (
                <li key={name}>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={checked.has(name)}
                      onChange={(e) => {
                        const next = new Set(checked);
                        e.target.checked ? next.add(name) : next.delete(name);
                        setChecked(next);
                      }}
                    />
                    {name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {candidates.length > 0 && (
            <button type="button" onClick={apply} disabled={busy || checked.size === 0}>
              {busy ? 'Applying…' : `Wire ${checked.size} prop(s)`}
            </button>
          )}
        </>
      )}
      {status && <SaveStatus status={status} />}
    </div>
  );
}

function InspectorPanel({ feature, file, node, contentHash, onSaved }) {
  if (!node) return <p className="hint">Select a tree node or preview element to inspect it.</p>;
  return (
    <GlassPanel className="inspector-panel">
      <SnippetEditor feature={feature} file={file} nodeId={node.id} contentHash={contentHash} onSaved={onSaved} />
      <div className="props-inspector">
        <h4>Props (#53)</h4>
        {node.isFragment ? (
          <p className="hint">Fragments have no props.</p>
        ) : node.props.filter((p) => p.kind !== 'spread').length === 0 ? (
          <p className="hint">No props on this node.</p>
        ) : (
          node.props
            .filter((p) => p.kind !== 'spread')
            .map((p) => (
              <PropRow key={p.name} feature={feature} file={file} nodeId={node.id} contentHash={contentHash} prop={p} onSaved={onSaved} />
            ))
        )}
      </div>
      {node.isCustomComponent && (
        <AutoMapPanel feature={feature} file={file} nodeId={node.id} contentHash={contentHash} onSaved={onSaved} />
      )}
    </GlassPanel>
  );
}

// ---------------------------------------------------------------------------
// #55 — colorful prop-flow diagram
// ---------------------------------------------------------------------------
const PALETTE = ['#5b8cff', '#3fae5a', '#d98c2b', '#e05a5a', '#b25be0', '#2bc4d9', '#e0c62b', '#e05ba0'];

function colorFor(name, map) {
  if (!map.has(name)) map.set(name, PALETTE[map.size % PALETTE.length]);
  return map.get(name);
}

function layoutTree(roots) {
  const positions = new Map();
  let nextX = 0;
  const NODE_W = 130;
  const NODE_H = 70;
  const visit = (node, depth) => {
    if (node.children.length === 0) {
      positions.set(node.id, { x: nextX * NODE_W, y: depth * NODE_H, node });
      nextX += 1;
      return positions.get(node.id).x;
    }
    const childXs = node.children.map((c) => visit(c, depth + 1));
    const x = (Math.min(...childXs) + Math.max(...childXs)) / 2;
    positions.set(node.id, { x, y: depth * NODE_H, node });
    return x;
  };
  for (const r of roots) visit(r, 0);
  return positions;
}

function PropFlowDiagram({ roots }) {
  const [visible, setVisible] = useState(false);
  const { positions, edges, colorMap } = useMemo(() => {
    const positions = layoutTree(roots);
    const colorMap = new Map();
    const edges = [];
    const parentOf = flattenParentOf(roots);
    for (const [id, pos] of positions) {
      const parentId = parentOf.get(id);
      if (!parentId) continue;
      const parentPos = positions.get(parentId);
      const namedProps = pos.node.props.filter((p) => p.kind !== 'spread');
      namedProps.forEach((p, i) => {
        edges.push({ from: parentPos, to: pos, prop: p.name, color: colorFor(p.name, colorMap), offset: i });
      });
    }
    return { positions, edges, colorMap };
  }, [roots]);

  const maxX = Math.max(20, ...[...positions.values()].map((p) => p.x)) + 130;
  const maxY = Math.max(20, ...[...positions.values()].map((p) => p.y)) + 60;

  return (
    <GlassPanel className="propflow-panel">
      <h3>Prop-flow diagram (#55)</h3>
      <button type="button" onClick={() => setVisible((v) => !v)}>
        {visible ? 'Hide diagram' : 'Show diagram'}
      </button>
      {visible && (
        <>
          <div className="propflow-legend">
            {[...colorMap.entries()].map(([name, color]) => (
              <span key={name} className="propflow-legend-item">
                <span className="propflow-swatch" style={{ background: color }} />
                {name}
              </span>
            ))}
            {colorMap.size === 0 && <span className="hint">No props flow between nodes in this tree.</span>}
          </div>
          <svg width={maxX} height={maxY} className="propflow-svg">
            {edges.map((e, i) => (
              <line
                key={i}
                x1={e.from.x + 60}
                y1={e.from.y + 20 + e.offset * 3}
                x2={e.to.x + 60}
                y2={e.to.y + 20 + e.offset * 3}
                stroke={e.color}
                strokeWidth={2}
                opacity={0.85}
              />
            ))}
            {[...positions.values()].map((p) => (
              <g key={p.node.id} transform={`translate(${p.x},${p.y})`}>
                <rect width={120} height={32} rx={6} className={`propflow-box${p.node.isCustomComponent ? ' component' : ''}`} />
                <text x={60} y={20} textAnchor="middle" className="propflow-box-label">
                  {p.node.isFragment ? '<>' : p.node.tag}
                </text>
              </g>
            ))}
          </svg>
        </>
      )}
    </GlassPanel>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------
export function PagesEditor() {
  const [features, setFeatures] = useState([]);
  const [feature, setFeature] = useState('');
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [file, setFile] = useState('');
  const [tree, setTree] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getFeatures().then((r) => setFeatures(r.features || []));
  }, []);

  useEffect(() => {
    setFile('');
    setTree(null);
    setSelectedNodeId(null);
    if (!feature) {
      setFiles([]);
      return;
    }
    setFilesLoading(true);
    api.getPages(feature).then((r) => {
      setFiles(r.files || []);
      setFilesLoading(false);
    });
  }, [feature]);

  function openFile(f) {
    setFile(f);
    setSelectedNodeId(null);
    setError(null);
    api.getPageTree(feature, f).then((r) => {
      if (r.error) setError(r.error);
      else setTree(r);
    });
  }

  const selectedNode = tree && selectedNodeId ? findNode(tree.roots, selectedNodeId) : null;

  return (
    <div className="page pages-editor-page">
      <h1>Pages Editor</h1>
      <p className="hint">
        Browse a feature's pages/ layer (#49), view a page's JSX as a tree (#50), select a node from
        either the tree or the structural preview (#51), edit its isolated snippet or props and save
        straight back into the source file (#52/#53), auto-map unwired props (#54), and see the
        whole tree's prop flow as a colored diagram (#55). Every save is scoped to pages/ and
        checked against the existing PAGE-*/COMPONENT-* architecture rules before it lands (#56).
      </p>

      <PagesBrowser
        feature={feature}
        onFeatureChange={setFeature}
        features={features}
        file={file}
        onOpen={openFile}
        files={files}
        loading={filesLoading}
      />

      {error && <p className="status-error">{error}</p>}

      {tree && (
        <>
          <div className="pages-editor-grid">
            <TreePanel roots={tree.roots} selectedId={selectedNodeId} onSelect={setSelectedNodeId} />
            <PreviewPanel roots={tree.roots} selectedId={selectedNodeId} onSelect={setSelectedNodeId} />
            <InspectorPanel
              feature={feature}
              file={file}
              node={selectedNode}
              contentHash={tree.contentHash}
              onSaved={(result) => setTree({ roots: result.roots, contentHash: result.contentHash })}
            />
          </div>
          <PropFlowDiagram roots={tree.roots} />
        </>
      )}
    </div>
  );
}

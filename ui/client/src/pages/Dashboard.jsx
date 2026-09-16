import { useState } from 'react';
import { api } from '../api.js';
import { CommandResult } from '../components/CommandResult.jsx';

const LAYERS = ['domain', 'service', 'workflow', 'hook', 'component', 'page', 'controller'];

function LayerCheckboxes({ selected, onChange }) {
  function toggle(layer) {
    onChange(selected.includes(layer) ? selected.filter((l) => l !== layer) : [...selected, layer]);
  }
  return (
    <div className="layer-checkboxes">
      {LAYERS.map((layer) => (
        <label key={layer} className="checkbox">
          <input type="checkbox" checked={selected.includes(layer)} onChange={() => toggle(layer)} />
          {layer}
        </label>
      ))}
    </div>
  );
}

function CreateForm() {
  const [kind, setKind] = useState('feature');
  const [name, setName] = useState('');
  const [feature, setFeature] = useState('');
  const [layer, setLayer] = useState(LAYERS[0]);
  const [layers, setLayers] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(e) {
    e.preventDefault();
    setBusy(true);
    setResult(await api.create({ kind, name, feature, layer, layers }));
    setBusy(false);
  }

  return (
    <form className="command-form" onSubmit={run}>
      <h3>Create</h3>
      <label className="field">
        <span>What to scaffold</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="feature">A new feature (all 7 layer folders)</option>
          <option value="layer">A vertical slice (several layers of one logical unit)</option>
          <option value="single">A single layer file</option>
        </select>
      </label>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CpoAccess" required />
      </label>
      {kind !== 'feature' && (
        <label className="field">
          <span>Feature</span>
          <input value={feature} onChange={(e) => setFeature(e.target.value)} placeholder="e.g. cpo-v2" required />
        </label>
      )}
      {kind === 'single' && (
        <label className="field">
          <span>Layer</span>
          <select value={layer} onChange={(e) => setLayer(e.target.value)}>
            {LAYERS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === 'layer' && (
        <label className="field">
          <span>Layers (built in dependency order regardless of the order checked)</span>
          <LayerCheckboxes selected={layers} onChange={setLayers} />
        </label>
      )}
      <button type="submit" disabled={busy}>
        {busy ? 'Running…' : 'Run create'}
      </button>
      <CommandResult result={result} />
    </form>
  );
}

function RefactorForm() {
  const [action, setAction] = useState('move');
  const [name, setName] = useState('');
  const [newName, setNewName] = useState('');
  const [feature, setFeature] = useState('');
  const [from, setFrom] = useState(LAYERS[0]);
  const [to, setTo] = useState(LAYERS[1]);
  const [layer, setLayer] = useState(LAYERS[0]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(e) {
    e.preventDefault();
    setBusy(true);
    setResult(await api.refactor({ action, name, newName, feature, from, to, layer }));
    setBusy(false);
  }

  return (
    <form className="command-form" onSubmit={run}>
      <h3>Refactor</h3>
      <p className="hint">Mechanical, LLM-free moves/renames — content and exported identifiers are never touched.</p>
      <label className="field">
        <span>Action</span>
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="move">Move (change layer)</option>
          <option value="rename">Rename (same layer)</option>
        </select>
      </label>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      {action === 'rename' && (
        <label className="field">
          <span>New name</span>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} required />
        </label>
      )}
      <label className="field">
        <span>Feature</span>
        <input value={feature} onChange={(e) => setFeature(e.target.value)} required />
      </label>
      {action === 'move' ? (
        <>
          <label className="field">
            <span>From layer</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              {LAYERS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>To layer</span>
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {LAYERS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <label className="field">
          <span>Layer</span>
          <select value={layer} onChange={(e) => setLayer(e.target.value)}>
            {LAYERS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" disabled={busy}>
        {busy ? 'Running…' : 'Run refactor'}
      </button>
      <CommandResult result={result} />
    </form>
  );
}

function ResearchForm() {
  const [action, setAction] = useState('doctor');
  const [feature, setFeature] = useState('');
  const [format, setFormat] = useState('json');
  const [since, setSince] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(e) {
    e.preventDefault();
    setBusy(true);
    setResult(await api.research({ action, feature: feature || undefined, format, since: since || undefined }));
    setBusy(false);
  }

  return (
    <form className="command-form" onSubmit={run}>
      <h3>Research</h3>
      <p className="hint">Read-only — never writes anything.</p>
      <label className="field">
        <span>Action</span>
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="doctor">Doctor (environment/tooling check)</option>
          <option value="summarize">Summarize a feature</option>
        </select>
      </label>
      {action === 'summarize' && (
        <>
          <label className="field">
            <span>Feature (optional — omit for the whole project)</span>
            <input value={feature} onChange={(e) => setFeature(e.target.value)} />
          </label>
          <label className="field">
            <span>Format</span>
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="json">json</option>
              <option value="md">md</option>
              <option value="compact">compact</option>
              <option value="prose">prose</option>
            </select>
          </label>
          <label className="field">
            <span>Since (git ref, optional)</span>
            <input value={since} onChange={(e) => setSince(e.target.value)} placeholder="e.g. main" />
          </label>
        </>
      )}
      <button type="submit" disabled={busy}>
        {busy ? 'Running…' : 'Run research'}
      </button>
      <CommandResult result={result} />
    </form>
  );
}

function ImportForm() {
  const [mode, setMode] = useState('unit');
  const [name, setName] = useState('');
  const [feature, setFeature] = useState('');
  const [layers, setLayers] = useState([]);
  const [from, setFrom] = useState('');
  const [planPath, setPlanPath] = useState('');
  const [useLlm, setUseLlm] = useState(false);
  const [llm, setLlm] = useState('claude');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(e) {
    e.preventDefault();
    setBusy(true);
    setResult(
      await api.importAction({
        mode,
        name,
        feature,
        layers,
        from,
        planPath,
        llm: useLlm ? llm : undefined,
      }),
    );
    setBusy(false);
  }

  return (
    <form className="command-form" onSubmit={run}>
      <h3>Import (non-interactive)</h3>
      <p className="hint">
        For a single old file or an already-approved plan file. For the guided, chat-style
        whole-route wizard, use the <strong>Import Wizard</strong> page instead.
      </p>
      <label className="field">
        <span>Mode</span>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="unit">Single unit (one old file)</option>
          <option value="plan">From an approved plan file</option>
        </select>
      </label>
      {mode === 'unit' ? (
        <>
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Feature</span>
            <input value={feature} onChange={(e) => setFeature(e.target.value)} required />
          </label>
          <label className="field">
            <span>Layers</span>
            <LayerCheckboxes selected={layers} onChange={setLayers} />
          </label>
          <label className="field">
            <span>From (path to the old source file)</span>
            <input value={from} onChange={(e) => setFrom(e.target.value)} required />
          </label>
        </>
      ) : (
        <label className="field">
          <span>Plan file path</span>
          <input value={planPath} onChange={(e) => setPlanPath(e.target.value)} placeholder="./plan.json" required />
        </label>
      )}
      <label className="checkbox">
        <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
        Have the LLM write the ported logic (otherwise: TODO(import) breadcrumbs only)
      </label>
      {useLlm && (
        <label className="field">
          <span>Provider</span>
          <input value={llm} onChange={(e) => setLlm(e.target.value)} />
        </label>
      )}
      <button type="submit" disabled={busy}>
        {busy ? 'Running…' : 'Run import'}
      </button>
      <CommandResult result={result} />
    </form>
  );
}

export function Dashboard() {
  return (
    <div className="page">
      <h1>Dashboard</h1>
      <p className="hint">
        Click-through equivalents of the CLI&apos;s create/refactor/research/import commands. Each
        result shows the deterministic tool output and, distinctly, any LLM involvement.
      </p>
      <div className="dashboard-grid">
        <CreateForm />
        <RefactorForm />
        <ResearchForm />
        <ImportForm />
      </div>
    </div>
  );
}

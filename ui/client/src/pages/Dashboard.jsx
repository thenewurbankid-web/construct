import { useState } from 'react';
import { api } from '../api.js';
import { CommandResult } from '../components/CommandResult.jsx';
import { Button, Field, GlassPanel, Input, Select } from '../components/ui/index.js';

const LAYERS = ['domain', 'service', 'workflow', 'hook', 'component', 'page', 'controller'];

function LayerCheckboxes({ selected, onChange }) {
  function toggle(layer) {
    onChange(selected.includes(layer) ? selected.filter((l) => l !== layer) : [...selected, layer]);
  }
  return (
    <div className="layer-checkboxes">
      {LAYERS.map((layer) => (
        <label key={layer} className="checkbox">
          <Input type="checkbox" checked={selected.includes(layer)} onChange={() => toggle(layer)} />
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
    <GlassPanel as="form" className="command-form" onSubmit={run}>
      <h3>Create</h3>
      <Field label="What to scaffold">
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="feature">A new feature (all 7 layer folders)</option>
          <option value="layer">A vertical slice (several layers of one logical unit)</option>
          <option value="single">A single layer file</option>
        </Select>
      </Field>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CpoAccess" required />
      </Field>
      {kind !== 'feature' && (
        <Field label="Feature">
          <Input value={feature} onChange={(e) => setFeature(e.target.value)} placeholder="e.g. cpo-v2" required />
        </Field>
      )}
      {kind === 'single' && (
        <Field label="Layer">
          <Select value={layer} onChange={(e) => setLayer(e.target.value)}>
            {LAYERS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {kind === 'layer' && (
        <Field label="Layers (built in dependency order regardless of the order checked)">
          <LayerCheckboxes selected={layers} onChange={setLayers} />
        </Field>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Running…' : 'Run create'}
      </Button>
      <CommandResult result={result} />
    </GlassPanel>
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
    <GlassPanel as="form" className="command-form" onSubmit={run}>
      <h3>Refactor</h3>
      <p className="hint">Mechanical, LLM-free moves/renames — content and exported identifiers are never touched.</p>
      <Field label="Action">
        <Select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="move">Move (change layer)</option>
          <option value="rename">Rename (same layer)</option>
        </Select>
      </Field>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      {action === 'rename' && (
        <Field label="New name">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} required />
        </Field>
      )}
      <Field label="Feature">
        <Input value={feature} onChange={(e) => setFeature(e.target.value)} required />
      </Field>
      {action === 'move' ? (
        <>
          <Field label="From layer">
            <Select value={from} onChange={(e) => setFrom(e.target.value)}>
              {LAYERS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="To layer">
            <Select value={to} onChange={(e) => setTo(e.target.value)}>
              {LAYERS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </Select>
          </Field>
        </>
      ) : (
        <Field label="Layer">
          <Select value={layer} onChange={(e) => setLayer(e.target.value)}>
            {LAYERS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </Select>
        </Field>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Running…' : 'Run refactor'}
      </Button>
      <CommandResult result={result} />
    </GlassPanel>
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
    <GlassPanel as="form" className="command-form" onSubmit={run}>
      <h3>Research</h3>
      <p className="hint">Read-only — never writes anything.</p>
      <Field label="Action">
        <Select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="doctor">Doctor (environment/tooling check)</option>
          <option value="summarize">Summarize a feature</option>
        </Select>
      </Field>
      {action === 'summarize' && (
        <>
          <Field label="Feature (optional — omit for the whole project)">
            <Input value={feature} onChange={(e) => setFeature(e.target.value)} />
          </Field>
          <Field label="Format">
            <Select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="json">json</option>
              <option value="md">md</option>
              <option value="compact">compact</option>
              <option value="prose">prose</option>
            </Select>
          </Field>
          <Field label="Since (git ref, optional)">
            <Input value={since} onChange={(e) => setSince(e.target.value)} placeholder="e.g. main" />
          </Field>
        </>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Running…' : 'Run research'}
      </Button>
      <CommandResult result={result} />
    </GlassPanel>
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
    <GlassPanel as="form" className="command-form" onSubmit={run}>
      <h3>Import (non-interactive)</h3>
      <p className="hint">
        For a single old file or an already-approved plan file. For the guided, chat-style
        whole-route wizard, use the <strong>Import Wizard</strong> page instead.
      </p>
      <Field label="Mode">
        <Select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="unit">Single unit (one old file)</option>
          <option value="plan">From an approved plan file</option>
        </Select>
      </Field>
      {mode === 'unit' ? (
        <>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Feature">
            <Input value={feature} onChange={(e) => setFeature(e.target.value)} required />
          </Field>
          <Field label="Layers">
            <LayerCheckboxes selected={layers} onChange={setLayers} />
          </Field>
          <Field label="From (path to the old source file)">
            <Input value={from} onChange={(e) => setFrom(e.target.value)} required />
          </Field>
        </>
      ) : (
        <Field label="Plan file path">
          <Input value={planPath} onChange={(e) => setPlanPath(e.target.value)} placeholder="./plan.json" required />
        </Field>
      )}
      <label className="checkbox">
        <Input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
        Have the LLM write the ported logic (otherwise: TODO(import) breadcrumbs only)
      </label>
      {useLlm && (
        <Field label="Provider">
          <Input value={llm} onChange={(e) => setLlm(e.target.value)} />
        </Field>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Running…' : 'Run import'}
      </Button>
      <CommandResult result={result} />
    </GlassPanel>
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

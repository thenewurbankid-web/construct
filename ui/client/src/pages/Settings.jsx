import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Button, Field, GlassPanel, Input, Select } from '../components/ui/index.js';

export function Settings({ onSettingsChange } = {}) {
  const [settings, setSettings] = useState(null);
  const [projectDirInput, setProjectDirInput] = useState('');
  const [llmProvider, setLlmProvider] = useState('');
  const [status, setStatus] = useState(null);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setProjectDirInput(s.projectDir || '');
      setLlmProvider(s.llmProvider || '');
    });
  }, []);

  async function save() {
    setStatus(null);
    const result = await api.updateSettings({ projectDir: projectDirInput, llmProvider });
    if (result.error) {
      setStatus({ ok: false, message: result.error });
    } else {
      setSettings(result);
      setStatus({ ok: true, message: 'Settings saved.' });
      // Let App's shared project-status (which the Dashboard/Wizard route
      // guard reads) pick up this directory's valid/needsInit right away,
      // rather than only updating this page's own local copy.
      onSettingsChange?.(result);
    }
  }

  if (!settings) return <p>Loading settings…</p>;

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="hint">
        These settings apply to every command run from this UI (dashboard actions and the import
        wizard). Nothing is persisted to disk — restarting the backend resets to its defaults.
      </p>

      <Field
        label="Project directory"
        hint={
          <>
            Passed as <code>--dir</code> to every command (same as the CLI). Must be an existing
            directory; it doesn&apos;t need <code>architecture.yml</code> yet if you plan to run{' '}
            <code>init</code>-equivalent actions from here first.
          </>
        }
      >
        <Input
          type="text"
          value={projectDirInput}
          onChange={(e) => setProjectDirInput(e.target.value)}
          placeholder="/path/to/your/construct-project"
        />
      </Field>

      <Field
        label="LLM provider"
        hint={
          <>
            Construct only ever calls an LLM for import&apos;s optional fill step and the route
            wizard&apos;s analysis step — everything else (create, refactor, research, and import&apos;s
            scaffolding) stays fully deterministic regardless of this setting.
          </>
        }
      >
        <Select value={llmProvider} onChange={(e) => setLlmProvider(e.target.value)}>
          <option value="">— none (LLM steps stay off unless a command opts in) —</option>
          {settings.availableProviders.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
      </Field>

      <Button onClick={save}>Save settings</Button>

      {status && (
        <p className={status.ok ? 'status-ok' : 'status-error'}>{status.message}</p>
      )}

      <GlassPanel className="settings-current">
        <h2>Current resolution</h2>
        <p>
          <strong>Project directory:</strong> {settings.projectDir}
        </p>
        <p>
          <strong>Resolved Construct project root:</strong>{' '}
          {settings.resolvedProjectRoot || (
            <em>none found (no architecture.yml above this directory) — run “create feature” or an init-equivalent first</em>
          )}
        </p>
        <p>
          <strong>LLM provider:</strong> {settings.llmProvider || <em>none</em>}
        </p>
      </GlassPanel>
    </div>
  );
}

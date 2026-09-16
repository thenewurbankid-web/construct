import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

/** Wraps a page that needs a valid Construct project (Dashboard, Wizard) and
 * blocks it behind a project-selection/init screen instead of letting it
 * render forms against a directory that has no architecture.yml anywhere
 * above it (see projectStatusFor in ui/server/src/index.mjs — `status.valid`
 * mirrors exactly what `getRoot` in src/cli.mjs would resolve for the same
 * directory). `status` is the current { valid, needsInit, projectDir, ... }
 * from App's shared getSettings() call; `onStatusChange` lets this refresh
 * that shared state after a successful init instead of holding its own
 * copy. */
export function ProjectGate({ status, onStatusChange, children }) {
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState(null);

  if (!status) return <p>Loading project status…</p>;

  if (!status.valid) {
    const handleInit = async () => {
      setInitializing(true);
      setError(null);
      const result = await api.init();
      setInitializing(false);
      if (result.error) {
        setError(result.error);
      } else {
        onStatusChange?.(result);
      }
    };

    return (
      <div className="page">
        <h1>No Construct project here yet</h1>
        <p className="hint">
          The selected project directory —{' '}
          <code>{status.projectDir}</code> — doesn&apos;t look like a Construct project: no{' '}
          <code>architecture.yml</code> was found there or in any parent directory.
        </p>
        <p>
          Pick a different, existing project in <Link to="/settings">Settings</Link>, or
          initialize a new one right here:
        </p>
        <button onClick={handleInit} disabled={initializing}>
          {initializing ? 'Initializing…' : 'Initialize Construct here'}
        </button>
        {error && <p className="status-error">{error}</p>}
      </div>
    );
  }

  return children;
}

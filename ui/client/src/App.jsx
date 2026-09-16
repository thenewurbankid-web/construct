import { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard.jsx';
import { Settings } from './pages/Settings.jsx';
import { Wizard } from './pages/Wizard.jsx';
import { Help } from './pages/Help.jsx';
import { PagesEditor } from './pages/PagesEditor.jsx';
import { ProjectGate } from './components/ProjectGate.jsx';
import { api } from './api.js';

export function App() {
  // The single source of truth for "is the currently selected project
  // directory a real Construct project" — { projectDir, resolvedProjectRoot,
  // valid, needsInit, ... } from GET /api/settings. Fetched once on load
  // (this *is* the "pick your project once, then work inside it" moment)
  // and refreshed whenever Settings saves a new directory or the gate below
  // successfully runs init, so Dashboard/Wizard never render against a
  // directory that isn't a Construct project yet.
  const [projectStatus, setProjectStatus] = useState(null);

  const refreshProjectStatus = useCallback(() => {
    api.getSettings().then(setProjectStatus);
  }, []);

  useEffect(() => {
    refreshProjectStatus();
  }, [refreshProjectStatus]);

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-title">Construct</div>
        <NavLink to="/" className={({ isActive }) => (isActive ? 'active' : '')} end>
          Dashboard
        </NavLink>
        <NavLink to="/wizard" className={({ isActive }) => (isActive ? 'active' : '')}>
          Import Wizard
        </NavLink>
        <NavLink to="/pages" className={({ isActive }) => (isActive ? 'active' : '')}>
          Pages Editor
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
          Settings
        </NavLink>
        <NavLink to="/help" className={({ isActive }) => (isActive ? 'active' : '')}>
          Help
        </NavLink>
      </nav>
      <main className="main">
        <Routes>
          <Route
            path="/"
            element={
              <ProjectGate status={projectStatus} onStatusChange={setProjectStatus}>
                <Dashboard />
              </ProjectGate>
            }
          />
          <Route
            path="/wizard"
            element={
              <ProjectGate status={projectStatus} onStatusChange={setProjectStatus}>
                <Wizard />
              </ProjectGate>
            }
          />
          <Route
            path="/pages"
            element={
              <ProjectGate status={projectStatus} onStatusChange={setProjectStatus}>
                <PagesEditor />
              </ProjectGate>
            }
          />
          <Route path="/settings" element={<Settings onSettingsChange={setProjectStatus} />} />
          <Route path="/help" element={<Help />} />
        </Routes>
      </main>
    </div>
  );
}

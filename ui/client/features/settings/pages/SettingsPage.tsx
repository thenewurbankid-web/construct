import type { ReactNode } from 'react';
import { SettingsForm } from '../components/SettingsForm';
import { SettingsSummary } from '../components/SettingsSummary';
import type { useSettings } from '../hooks/useSettings';

type SettingsPageProps = ReturnType<typeof useSettings>;

export function SettingsPage({ settings, projectDirInput, setProjectDirInput, llmProviders, setLlmProvider, status, save }: SettingsPageProps): ReactNode {
  if (!settings) return <p>Loading settings…</p>;

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="hint">
        These settings apply to every command run from this UI (dashboard actions and the import
        wizard). Nothing is persisted to disk — restarting the backend resets to its defaults.
      </p>

      <SettingsForm
        projectDirInput={projectDirInput}
        setProjectDirInput={setProjectDirInput}
        llmProviders={llmProviders}
        setLlmProvider={setLlmProvider}
        availableProviders={settings.availableProviders}
        availableProvidersByCapability={settings.availableProvidersByCapability}
        status={status}
        onSave={save}
      />

      <SettingsSummary
        projectDir={settings.projectDir}
        resolvedProjectRoot={settings.resolvedProjectRoot}
        llmProviders={settings.llmProviders}
      />
    </div>
  );
}

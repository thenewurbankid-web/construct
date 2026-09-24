import type { ReactNode } from 'react';
import { ErrorState, LoadingState } from '@/features/states';
import { SettingsForm } from '../components/SettingsForm';
import { SettingsSummary } from '../components/SettingsSummary';
import type { useSettings } from '../hooks/useSettings';

type SettingsPageProps = ReturnType<typeof useSettings> & {
  picker?: ReactNode;
  /** Commit-on-save controls (#283), supplied by the controller as a slot. */
  gitSession?: ReactNode;
  /** #330: connect the open project to a remote (another feature's controller). */
  remote?: ReactNode;
  /** #638: the GitHub connection for private repositories (another feature's controller; renders nothing when the server has none). */
  github?: ReactNode;
};

export function SettingsPage({ settings, loadError, reload, projectDirInput, setProjectDirInput, llmProviders, setLlmProvider, status, save, pickerOpen, togglePicker, picker, gitSession, remote, github }: SettingsPageProps): ReactNode {
  if (!settings) {
    return (
      <div className="page page--screen">
        {loadError ? (
          <ErrorState title="Could not load settings" hint={loadError} onRetry={reload} />
        ) : (
          <LoadingState label="Loading settings" hint="Reading the backend's current settings." />
        )}
      </div>
    );
  }

  return (
    <div className="page page--screen">
      <h1>Settings</h1>
      <p className="hint">
        These settings apply to every command run from this UI. Nothing is persisted to disk —
        restarting the backend resets to its defaults.
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
        pickerOpen={pickerOpen}
        onTogglePicker={togglePicker}
        picker={picker}
      />

      {gitSession}
      {remote}
      {github}

      <SettingsSummary projectDir={settings.projectDir} resolvedProjectRoot={settings.resolvedProjectRoot} />
    </div>
  );
}

'use client';

import { useEditor } from '@craftjs/core';
import { useReducer } from 'react';
import { componentName, serializeToTsx } from '../domain/TsxExport';
import { exportFile, loadLayout, saveLayout } from '../services/LayoutStore';
import type { PageBuilderPageProps } from '../types';
import { builderReducer, initialBuilder } from '../workflows/BuilderFlow';

/** Everything the builder screen does: export the Craft tree as TSX, save/load it in this browser, copy/download the
 * export. Must run inside Craft's `<Editor>`. No model is called. */
export function usePageBuilder(): PageBuilderPageProps {
  const { actions, query } = useEditor();
  const [state, send] = useReducer(builderReducer, initialBuilder);
  const status = (text: string) => send({ type: 'STATUS', status: text });
  const load = () => {
    const json = loadLayout(state.name);
    if (!json) return status(`Nothing saved as "${state.name}" in this browser.`);
    actions.deserialize(json);
    status(`Loaded "${state.name}".`);
  };
  return {
    name: state.name,
    status: state.status,
    exported: state.exported,
    onRename: (name) => send({ type: 'RENAMED', name }),
    onExport: () => send({ type: 'EXPORTED', tsx: serializeToTsx(JSON.parse(query.serialize()), { name: state.name }) }),
    onSave: () => status(saveLayout(state.name, query.serialize()) ? `Saved "${state.name}" in this browser.` : 'This browser refused to save the layout.'),
    onLoad: load,
    onCopy: () => void exportFile.copy(state.exported ?? '').then((ok) => status(ok ? 'Copied to the clipboard.' : 'The clipboard refused the copy.')),
    onDownload: () => exportFile.download(`${componentName(state.name)}.tsx`, state.exported ?? ''),
    onCloseExport: () => send({ type: 'EXPORT_CLOSED' }),
  };
}

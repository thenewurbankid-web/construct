'use client';

// The ONLY file that imports Monaco (@monaco-editor/react, MIT; monaco-editor,
// MIT). It implements SourceEditorProps and nothing else; swap this file (or
// select the textarea adapter in SourceEditor) to replace Monaco entirely.
// Monaco's runtime loads from NEXT_PUBLIC_MONACO_VS_PATH when set (self-host
// the `min/vs` folder), otherwise from the library's default CDN.
import Editor, { loader } from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useRef } from 'react';
import type { SourceEditorProps, SourceMarker } from '../types';

const OWNER = 'construct-diagnostics';
const vsPath = process.env.NEXT_PUBLIC_MONACO_VS_PATH;
if (vsPath) loader.config({ paths: { vs: vsPath } });

type MonacoApi = Parameters<OnMount>[1];
type EditorApi = Parameters<OnMount>[0];

function toMonacoMarkers(monaco: MonacoApi, markers: SourceMarker[]) {
  const severity = { error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info };
  return markers.map((m) => ({
    severity: severity[m.severity],
    message: m.message,
    code: m.code,
    source: m.source,
    startLineNumber: m.startLine,
    startColumn: m.startColumn,
    endLineNumber: m.endLine,
    endColumn: m.endColumn,
  }));
}

export function MonacoSourceEditor({ value, markers, readOnly, onChange, label = 'Page source', onUnavailable }: SourceEditorProps & { onUnavailable?: () => void }) {
  const monacoRef = useRef<MonacoApi | null>(null);
  const editorRef = useRef<EditorApi | null>(null);

  const applyMarkers = useCallback(() => {
    const model = editorRef.current?.getModel();
    if (monacoRef.current && model) monacoRef.current.editor.setModelMarkers(model, OWNER, toMonacoMarkers(monacoRef.current, markers));
  }, [markers]);

  // If Monaco's runtime can't be fetched (offline, blocked CDN) fall back.
  useEffect(() => {
    loader.init().catch(() => onUnavailable?.());
  }, [onUnavailable]);

  useEffect(applyMarkers, [applyMarkers, value]);

  return (
    <div className="source-editor-monaco" data-source-editor="monaco" aria-label={label}>
      <Editor
        height={Math.min(560, Math.max(200, (value.split('\n').length + 1) * 19))}
        language="typescript"
        path="page-source.tsx"
        theme="vs-dark"
        value={value}
        onChange={(v) => onChange?.(v ?? '')}
        onMount={(editor, monaco) => {
          editorRef.current = editor;
          monacoRef.current = monaco;
          // Diagnostics come from the server (real project tsconfig), not the
          // in-browser TS worker, which can't resolve the project's modules.
          monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
          monaco.languages.typescript.typescriptDefaults.setCompilerOptions({ jsx: monaco.languages.typescript.JsxEmit.Preserve, allowNonTsExtensions: true });
          applyMarkers();
        }}
        options={{ readOnly, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13, automaticLayout: true }}
      />
    </div>
  );
}

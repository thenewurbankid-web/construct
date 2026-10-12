// @line-level molecule
'use client';
import { useId, useRef, useState, type DragEvent } from 'react';

export type FileUploadProps = {
  label: string;
  /** Accepted types, as for <input accept>. */
  accept?: string;
  multiple?: boolean;
  /** The chosen files (controlled); omit to let it keep its own list. */
  files?: File[];
  onFilesChange?: (files: File[]) => void;
  onRemove?: (file: File) => void;
  disabled?: boolean;
  /** Lists the files without the pick and remove buttons. */
  readOnly?: boolean;
  /** A file is needed: the input is required and the label says so. */
  required?: boolean;
  description?: string;
  error?: string;
};

/** Pick or drop files; lists them with remove buttons. The file input stays real (and labelled) but visually hidden. */
export function FileUpload({ label, accept, multiple = false, files, onFilesChange, onRemove, disabled = false, readOnly = false, required = false, description, error }: FileUploadProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [own, setOwn] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const list = files ?? own;
  const describedBy = [description ? `${id}-description` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  const update = (next: File[]) => { setOwn(next); onFilesChange?.(next); };
  const add = (picked: File[]) => { if (!disabled && !readOnly && picked.length) update(multiple ? [...list, ...picked] : picked.slice(0, 1)); };
  const remove = (f: File) => { update(list.filter((x) => x !== f)); onRemove?.(f); };
  const onDrop = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragOver(false); add(Array.from(e.dataTransfer.files)); };
  return (
    <div className="flex flex-col gap-2">
      <div
        data-part="dropzone"
        data-drag-over={dragOver ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 p-6 text-center data-[disabled]:opacity-50 data-[drag-over]:border-slate-900 data-[drag-over]:bg-slate-50"
      >
        <input ref={input} id={id} type="file" aria-label={label} required={required} accept={accept} multiple={multiple} disabled={disabled} aria-describedby={describedBy} aria-invalid={error ? true : undefined} className="sr-only" tabIndex={-1} onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        <PickButton show={!readOnly} label={label} required={required} disabled={disabled} describedBy={describedBy} onPick={() => input.current?.click()} />
        <DropHint show={!readOnly} multiple={multiple} />
        <Hint id={`${id}-description`} text={description} />
      </div>
      <FileList files={list} disabled={disabled} readOnly={readOnly} onRemove={remove} />
      <ErrorText id={`${id}-error`} text={error} />
    </div>
  );
}

function FileList({ files, disabled, readOnly, onRemove }: { files: File[]; disabled: boolean; readOnly: boolean; onRemove: (f: File) => void }) {
  if (!files.length) return null;
  return (
    <ul data-part="list" aria-label="Chosen files" className="flex flex-col gap-1">
      {files.map((f) => (
        <li key={`${f.name}-${f.size}-${f.lastModified}`} data-part="item" className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
          <span className="truncate text-slate-900">{f.name}</span>
          <RemoveFile show={!readOnly} file={f} disabled={disabled} onRemove={onRemove} />
        </li>
      ))}
    </ul>
  );
}

function PickButton({ show, label, required, disabled, describedBy, onPick }: { show: boolean; label: string; required: boolean; disabled: boolean; describedBy?: string; onPick: () => void }) {
  if (!show) return null;
  return (
    <button type="button" data-part="trigger" disabled={disabled} aria-describedby={describedBy} onClick={onPick} className="inline-flex h-10 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed">
      {label}
      <RequiredHint show={required} />
    </button>
  );
}

function RequiredHint({ show }: { show: boolean }) {
  if (!show) return null;
  return <><span aria-hidden="true" className="ml-0.5 text-red-600">*</span><span className="sr-only"> (required)</span></>;
}

function DropHint({ show, multiple }: { show: boolean; multiple: boolean }) {
  if (!show) return null;
  return <p className="text-sm text-slate-600">or drop {multiple ? 'files' : 'a file'} here</p>;
}

function RemoveFile({ show, file, disabled, onRemove }: { show: boolean; file: File; disabled: boolean; onRemove: (f: File) => void }) {
  if (!show) return null;
  return <button type="button" data-part="remove" disabled={disabled} aria-label={`Remove ${file.name}`} onClick={() => onRemove(file)} className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900"><span aria-hidden="true">✕</span></button>;
}

function Hint({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return <p id={id} className="text-xs text-slate-500">{text}</p>;
}

function ErrorText({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return <p id={id} role="alert" className="text-sm text-red-700">{text}</p>;
}

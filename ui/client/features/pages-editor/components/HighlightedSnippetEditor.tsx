'use client';

import { useRef } from 'react';

type HighlightedSnippetEditorProps = {
  value: string;
  highlightedHtml: string;
  onChange: (value: string) => void;
};

// #81 — a transparent <textarea> laid directly over a syntax-highlighted
// <pre>, the standard "highlighted code editor" overlay technique: real
// typing/selection/caret behavior comes from the native textarea (text
// itself painted transparent), while the highlighted markup renders behind
// it. Scroll position is kept in sync so the highlight never drifts from
// what's actually being edited. Presentation only — the highlighted markup
// itself is computed one layer up (a hook calling a pure function), never
// here.
export function HighlightedSnippetEditor({ value, highlightedHtml, onChange }: HighlightedSnippetEditorProps) {
  const preRef = useRef<HTMLPreElement>(null);

  function syncScroll(e: React.UIEvent<HTMLTextAreaElement>) {
    if (!preRef.current) return;
    preRef.current.scrollTop = e.currentTarget.scrollTop;
    preRef.current.scrollLeft = e.currentTarget.scrollLeft;
  }

  const rows = Math.min(16, Math.max(4, value.split('\n').length + 1));

  return (
    <div className="snippet-editor-code" style={{ height: `${rows * 1.4 + 1}em` }}>
      <pre ref={preRef} className="snippet-highlight" aria-hidden="true">
        <code
          className="language-jsx"
          // eslint-disable-next-line react/no-danger -- Prism's own escaped output (#81); never raw user HTML.
          dangerouslySetInnerHTML={{ __html: `${highlightedHtml}\n` }}
        />
      </pre>
      <textarea
        className="snippet-textarea snippet-textarea-overlay"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        aria-label="Snippet source"
      />
    </div>
  );
}

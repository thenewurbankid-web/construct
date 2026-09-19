type HelpTocProps = { topics: Array<{ id: string; label: string }> };

/** Help's table of contents as it appears in the shell's Browser pane. */
export function HelpToc({ topics }: HelpTocProps) {
  return (
    <nav aria-label="Help contents" className="help-toc">
      {topics.map((t) => (
        <a key={t.id} href={`#${t.id}`}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}

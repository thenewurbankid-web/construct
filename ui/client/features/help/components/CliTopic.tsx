type CliTopicProps = { id: string; title: string; text: string };

// #162 — the CLI reference's real "wall of text" problem is here: grouped/
// flat/rest between them can be dozens of these, each previously an
// always-expanded <div>. A native <details>/<summary> (collapsed by
// default) makes each one individually expandable with no JS state, no new
// dependency, and full keyboard/screen-reader support for free — all the
// same content, just not force-rendered open on page load.
export function CliTopic({ id, title, text }: CliTopicProps) {
  return (
    <details className="help-topic" id={`cli-${id}`}>
      <summary>{title}</summary>
      <pre className="command-output help-pre">{text}</pre>
    </details>
  );
}

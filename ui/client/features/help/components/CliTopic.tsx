type CliTopicProps = { id: string; title: string; text: string };

export function CliTopic({ id, title, text }: CliTopicProps) {
  return (
    <div className="help-topic" id={`cli-${id}`}>
      <h4>{title}</h4>
      <pre className="command-output help-pre">{text}</pre>
    </div>
  );
}

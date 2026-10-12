'use client';

/** A project as a card inside a chat answer (the ProjectCard Line element): one click opens it. */
export function ChatProjectCard({ name, onOpenProject }: { name: string; onOpenProject: (name: string) => void }) {
  return (
    <button type="button" className="ln-project-card op-chat-card" onClick={() => onOpenProject(name)} aria-label={`Open ${name}`} data-testid="chat-project-card" data-line-control="open-project.card" data-line-target={name}>
      <span className="ln-project-name">{name}</span>
    </button>
  );
}

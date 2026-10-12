// @line-level molecule
'use client';
import { useId, type ReactNode } from 'react';

export type CardProps = {
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** Makes the whole card one pressable target; its title becomes the button, so the name stays the title. */
  onPress?: () => void;
  /** Marks the card as chosen (aria-pressed on an interactive card, aria-current otherwise). */
  selected?: boolean;
  variant?: 'outline' | 'elevated';
  className?: string;
};

/** A framed group of related content; optionally one big pressable target (the "stretched link" pattern). */
export function Card({ title, description, children, footer, onPress, selected = false, variant = 'outline', className = '' }: CardProps) {
  const id = useId();
  const look = variant === 'elevated' ? 'shadow-md' : 'border border-slate-200';
  return (
    <section
      aria-labelledby={`${id}-title`}
      aria-current={selected && !onPress ? 'true' : undefined}
      data-variant={variant}
      data-selected={selected ? '' : undefined}
      data-interactive={onPress ? '' : undefined}
      className={`relative flex flex-col gap-3 rounded-lg bg-white p-4 data-[interactive]:hover:bg-slate-50 data-[selected]:ring-2 data-[selected]:ring-slate-900 ${look} ${className}`}
    >
      <header data-part="header">
        <h3 id={`${id}-title`} data-part="title" className="text-base font-semibold text-slate-900">
          <CardTitle title={title} onPress={onPress} selected={selected} />
        </h3>
        <CardDescription text={description} />
      </header>
      <CardSlot part="body" content={children} />
      <CardSlot part="footer" content={footer} />
    </section>
  );
}

function CardTitle({ title, onPress, selected }: { title: string; onPress?: () => void; selected: boolean }) {
  if (!onPress) return <>{title}</>;
  return (
    <button type="button" onClick={onPress} aria-pressed={selected} className="text-left after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-slate-900">
      {title}
    </button>
  );
}

function CardDescription({ text }: { text?: string }) {
  if (!text) return null;
  return <p data-part="description" className="mt-1 text-sm text-slate-600">{text}</p>;
}

function CardSlot({ part, content }: { part: 'body' | 'footer'; content?: ReactNode }) {
  if (content === undefined || content === null) return null;
  return <div data-part={part} className="text-sm text-slate-700">{content}</div>;
}

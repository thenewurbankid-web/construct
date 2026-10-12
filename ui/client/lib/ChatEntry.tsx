'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { ChatAsk, ChatEntryProps, ChatItem, ChatMessage, ChatOption } from './lineChat';
import { StreamedText } from './StreamedText';
import './line-style.css';

// cd1: the chat entry of a Line screen, in Trace's style (lib/line-style.css). With nothing selected the chat fills
// the screen; once an item is picked, the item's page (children) fills it and the chat is a side panel beside it.

const detailLine = (d: string) => <li key={d}>{d}</li>;

/** Technical lines (rule, file:line, tool call), collapsed under Details; nothing when there are none. */
export function Details({ lines, testId }: { lines?: string[]; testId?: string }) {
  if (!lines?.length) return null;
  return (
    <details className="ln-details" data-testid={testId}>
      <summary>Details</summary>
      <ul>{lines.map(detailLine)}</ul>
    </details>
  );
}

/** A status pill: the words in text colour, the tone as a coloured dot (fit, wait, gap). */
export function StatusChip({ tone, label, testId }: { tone: string; label: string; testId?: string }) {
  return (
    <span className="ln-chip" data-tone={tone} data-testid={testId}>
      {label}
    </span>
  );
}

function ItemStatus({ item }: { item: ChatItem }) {
  if (!item.status) return null;
  return <StatusChip tone={item.status.tone} label={item.status.label} testId="ln-pick-status" />;
}

/** The items a message offers to pick (features, library items, fixes). */
function Picks({ message, onPick, busy }: { message: ChatMessage; onPick: ChatEntryProps['onPick']; busy?: boolean }) {
  if (!message.pick) return null;
  const pick = (it: ChatItem) => (
    <li key={it.id}>
      <button type="button" className="ln-pick" data-testid="ln-pick" data-item={it.id} data-line-control={it.control} data-line-target={it.control ? it.id : undefined} disabled={busy} onClick={() => onPick(message.id, it.id)}>
        <span className="ln-pick-top">
          <span className="ln-pick-name">{it.name}</span>
          <ItemStatus item={it} />
        </span>
        <span className="ln-pick-text">{it.text}</span>
      </button>
    </li>
  );
  return (
    <ul className="ln-picks" aria-label={message.pick.label}>
      {message.pick.items.map(pick)}
    </ul>
  );
}

function MessageLink({ link }: { link?: ChatMessage['link'] }) {
  if (!link) return null;
  return (
    <a href={link.href} className="ln-btn ln-btn--sm" data-testid="ln-msg-link">
      {link.label}
    </a>
  );
}

/** One message: the plain-English text first, then what can be picked, then the technical lines under Details. */
function MessageText({ message, elements }: { message: ChatMessage; elements?: ChatEntryProps['elements'] }) {
  // What the person typed is shown as typed; Line's answers stream in (flowtoken), with the screen's Line elements.
  if (message.from === 'you') {
    return (
      <p className="ln-msg-text" data-testid="ln-msg-text">
        {message.text}
      </p>
    );
  }
  return <StreamedText text={message.text} elements={elements} className="ln-msg-text" testId="ln-msg-text" />;
}

function Message({ message, onPick, busy, elements }: { message: ChatMessage; onPick: ChatEntryProps['onPick']; busy?: boolean; elements?: ChatEntryProps['elements'] }) {
  return (
    <li className="ln-msg" data-from={message.from} data-tone={message.tone ?? 'plain'} data-testid="ln-msg" data-msg={message.id}>
      <MessageText message={message} elements={elements} />
      <Picks message={message} onPick={onPick} busy={busy} />
      <MessageLink link={message.link} />
      <Details lines={message.details} testId="ln-msg-details" />
    </li>
  );
}

/** The predefined options, each with its stable id; a disabled one says why in its title. */
function Options({ options, onOption, busy }: { options: ChatOption[]; onOption: ChatEntryProps['onOption']; busy?: boolean }) {
  const option = (o: ChatOption) => (
    <button key={o.id} type="button" className="ln-opt" data-option-id={o.id} data-effect={o.effect} data-testid="ln-option" disabled={busy || o.disabled !== undefined} title={o.disabled ?? o.sentence} onClick={() => onOption(o.id)}>
      {o.label}
      <small>{o.sentence}</small>
    </button>
  );
  return (
    <div className="ln-opts" role="group" aria-label="What you can do">
      {options.map(option)}
    </div>
  );
}

/** A question waiting for a typed answer, in place of the options; Enter or the button answers it. */
function Ask({ ask, onAnswer, onCancel, busy }: { ask: ChatAsk; onAnswer?: ChatEntryProps['onAnswer']; onCancel?: () => void; busy?: boolean }) {
  const [text, setText] = useState(ask.suggestion);
  useEffect(() => setText(ask.suggestion), [ask.id, ask.suggestion]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAnswer?.(ask.id, text.trim());
  };
  return (
    <form className="ln-ask" aria-label={ask.label} onSubmit={submit} data-testid="ln-ask">
      <label htmlFor={`ln-ask-${ask.id}`}>{ask.label}</label>
      <span className="ln-ask-row">
        <input id={`ln-ask-${ask.id}`} className="ln-txt" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        <button type="submit" className="ln-btn ln-btn--primary" disabled={busy || !text.trim()}>
          {ask.submit}
        </button>
        <button type="button" className="ln-btn ln-btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </form>
  );
}

function Controls(p: ChatEntryProps) {
  if (p.ask) return <Ask ask={p.ask} onAnswer={p.onAnswer} onCancel={p.onCancelAsk} busy={p.busy} />;
  return <Options options={p.options} onOption={p.onOption} busy={p.busy} />;
}

/** A free request box (a screen's chat helper): Enter or the button sends it, and the box is cleared. */
function RequestBox({ input, onAnswer, busy }: { input?: ChatAsk | null; onAnswer?: ChatEntryProps['onAnswer']; busy?: boolean }) {
  const [text, setText] = useState('');
  if (!input) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    setText('');
    if (t) onAnswer?.(input.id, t);
  };
  return (
    <form className="ln-ask" aria-label={input.label} onSubmit={submit} data-testid="ln-request">
      <label htmlFor={`ln-request-${input.id}`}>{input.label}</label>
      <span className="ln-ask-row">
        <input id={`ln-request-${input.id}`} className="ln-txt" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} data-testid="ln-request-input" />
        <button type="submit" className="ln-btn ln-btn--primary" disabled={busy || !text.trim()}>
          {input.submit}
        </button>
      </span>
    </form>
  );
}

function Page({ selected, children }: Pick<ChatEntryProps, 'selected' | 'children'>) {
  if (selected === null) return null;
  return <div className="ln-ce-page">{children}</div>;
}

/** The chat entry (contract: lib/lineChat.ts ChatEntryProps). */
export function ChatEntry(p: ChatEntryProps) {
  const layout = p.layout ?? (p.selected === null ? 'full' : 'side');
  const Heading = layout === 'full' ? 'h1' : 'h2';
  const message = (m: ChatMessage) => <Message key={m.id} message={m} onPick={p.onPick} busy={p.busy} elements={p.elements} />;
  return (
    <section className="ln ln-chat-entry" data-layout={layout} data-testid={p.testId ?? 'ln-chat-entry'} aria-busy={p.busy ?? false}>
      <Page selected={p.selected}>{p.children}</Page>
      <div className="ln-ce-chat" data-testid="ln-chat" role="region" aria-label={`${p.title} chat`}>
        <Heading className="ln-ce-title">{p.title}</Heading>
        <ol className="ln-ce-log" aria-live="polite" aria-label="Conversation">
          {p.messages.map(message)}
        </ol>
        <Controls {...p} />
        <RequestBox input={p.input} onAnswer={p.onAnswer} busy={p.busy} />
        {p.footer}
      </div>
    </section>
  );
}

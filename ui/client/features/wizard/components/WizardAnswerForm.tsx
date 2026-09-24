import type { FormEvent } from 'react';
import { Button, Input } from '@/components/ui';

type WizardAnswerFormProps = {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  /** Present when the question wants a project path: opens the project picker (#600). */
  onBrowse?: () => void;
};

export function WizardAnswerForm({ input, setInput, onSubmit, onBrowse }: WizardAnswerFormProps) {
  return (
    <form className="chat-input" onSubmit={onSubmit}>
      <Input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type your answer…" />
      {onBrowse && <Button type="button" onClick={onBrowse}>Browse project…</Button>}
      <Button type="submit">Send</Button>
    </form>
  );
}

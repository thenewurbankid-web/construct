import type { FormEvent } from 'react';
import { Button, Input } from '@/components/ui';

type WizardAnswerFormProps = {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
};

export function WizardAnswerForm({ input, setInput, onSubmit }: WizardAnswerFormProps) {
  return (
    <form className="chat-input" onSubmit={onSubmit}>
      <Input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type your answer…" />
      <Button type="submit">Send</Button>
    </form>
  );
}

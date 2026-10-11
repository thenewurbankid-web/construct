import type { TrainWorld } from '../types';

type Props = {
  worlds: TrainWorld[];
  world: string;
  chooseWorld: (k: string) => void;
  suggestions: string[];
  text: string;
  setText: (t: string) => void;
  submit: () => void;
  pick: (s: string) => void;
};

/** Where the person types a request (or picks a suggested one, one click) and the project it is drafted over. */
export function RequestBox({ worlds, world, chooseWorld, suggestions, text, setText, submit, pick }: Props) {
  const option = (w: TrainWorld) => <option key={w.key} value={w.key}>{w.label}</option>;
  const chip = (s: string) => (
    <button key={s} type="button" className="ltr-btn" data-testid="train-suggestion" onClick={() => pick(s)}>
      {s}
    </button>
  );
  return (
    <form className="ltr-note" onSubmit={(e) => { e.preventDefault(); submit(); }} aria-label="Teach a request">
      <label className="ltr-field">
        Project to draft it over
        <select className="ltr-select" value={world} onChange={(e) => chooseWorld(e.target.value)}>
          {worlds.map(option)}
        </select>
      </label>
      <div className="ltr-request">
        <label htmlFor="ltr-request-input" className="ltr-inline">What should Line do?</label>
        <input id="ltr-request-input" className="ltr-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Make StatusBadge in orders, based on Badge." />
        <button type="submit" className="ltr-btn ltr-btn--primary">Draft</button>
      </div>
      <div className="ltr-chips" role="group" aria-label="Suggested requests">{suggestions.map(chip)}</div>
    </form>
  );
}

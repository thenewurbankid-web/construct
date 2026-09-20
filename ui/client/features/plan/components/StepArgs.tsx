import type { ArgView } from '../types';

type Props = { args: ArgView[]; onArg: (name: string, value: string) => void };

/** The editable arguments of one step. Empty clears an argument; whatever is left, the validator judges. */
export function StepArgs({ args, onArg }: Props) {
  if (args.length === 0) return null;
  return (
    <div className="pl-args">
      {args.map((a) => (
        <label key={a.name} className="pl-arg" title={a.description ?? undefined}>
          <span>{a.label}</span>
          {a.enum ? (
            <select value={a.value} onChange={(e) => onArg(a.name, e.target.value)} data-testid={`plan-arg-${a.name}`}>
              <option value="">(not set)</option>
              {a.enum.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <input value={a.value} onChange={(e) => onArg(a.name, e.target.value)} data-testid={`plan-arg-${a.name}`} />
          )}
        </label>
      ))}
    </div>
  );
}

'use client';

// #748 (R6) -- the table view of an accepted machine-spec.v1: states, events, transitions and functions, each
// row the two standard exits (docs/BLOCK-CONTRACT.md): "View/edit code" (opens the generated file once
// "Generate" has written it) and, for functions only, "Fill with AI" (create.unit with an LLM).
import { rowsByGroup } from '../domain/SpecBreakdownView';
import type { ReadBack, SpecRowGroup } from '../types';

const GROUP_LABEL: Record<SpecRowGroup, string> = { states: 'States', events: 'Events', transitions: 'Transitions', functions: 'Functions' };

type Props = {
  readBack: ReadBack;
  feature: string;
  generated: boolean;
  onViewCode: (name: string) => void;
  onFillWithAi: (name: string) => void;
  fillBusyFor: string | null;
};

function GroupTable({ readBack, group, feature, generated, onViewCode, onFillWithAi, fillBusyFor }: Props & { group: SpecRowGroup }) {
  const rows = rowsByGroup(readBack, group);
  if (rows.length === 0) return null;
  const isFunctions = group === 'functions';
  return (
    <table className="sb-table" data-testid={`sb-table-${group}`}>
      <caption>{GROUP_LABEL[group]}</caption>
      <thead>
        <tr>
          <th scope="col">Id</th>
          <th scope="col">Read-back</th>
          {isFunctions && <th scope="col">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.group}:${row.id}`} data-testid="sb-row" data-row-id={row.id}>
            <td><code>{row.id}</code></td>
            <td>{row.text}</td>
            {isFunctions && (
              <td className="sb-row-actions">
                <button type="button" className="dg-btn" disabled={!generated} title={generated ? undefined : 'Generate the spec first.'} onClick={() => onViewCode(row.id)} data-testid="sb-view-code">
                  View/edit code
                </button>
                <button type="button" className="dg-btn" disabled={fillBusyFor === row.id} onClick={() => onFillWithAi(row.id)} data-testid="sb-fill-ai">
                  {fillBusyFor === row.id ? 'Filling…' : 'Fill with AI'}
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** All four group tables, in the spec's own order; a group with no rows draws nothing rather than an empty table. */
export function SpecTable(props: Props) {
  return (
    <div className="sb-spec-table" data-testid="sb-spec-table">
      {(['states', 'events', 'transitions', 'functions'] as SpecRowGroup[]).map((group) => (
        <GroupTable key={group} {...props} group={group} />
      ))}
    </div>
  );
}

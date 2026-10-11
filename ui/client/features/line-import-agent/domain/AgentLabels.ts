// Pure (DOMAIN-001): the plain words the Import agent screen uses for the states the server sends.

/** Plain labels, by what they label. */
export const LABELS = {
  run: { todo: 'To do', running: 'Running', done: 'Done', 'needs-you': 'Needs you', left: 'Left as it is' } as Record<string, string>,
  review: { proposed: 'Not approved yet', approved: 'Approved', skipped: 'Skipped' } as Record<string, string>,
  who: { ui: 'You', agent: 'Your agent', line: 'Line' } as Record<string, string>,
  decider: {
    jev: 'jev picked it', static: 'Line took the recommended option', single: 'The only option that passed the checks',
    order: 'The first option that passed the checks', person: 'You picked it',
  } as Record<string, string>,
  check: { pass: 'Passed', fail: 'Failed', skipped: 'Not run' } as Record<string, string>,
  checkName: {
    validate: 'Line rules', types: 'Types', tests: 'Tests',
    'char-tests': 'Characterization tests', 'logic-map': 'Logic kept', behaviour: 'Same behaviour', coverage: 'Unit coverage',
  } as Record<string, string>,
  loop: { ok: 'Kept everything', stopped: 'Stopped' } as Record<string, string>,
};

/** The fields a step lets you change (contract.mjs IMPORT_EDITABLE), with a plain label each. */
export const EDITABLE: Record<string, { key: string; label: string }[]> = {
  'line.import.mark': [{ key: 'features', label: 'Features (comma separated)' }],
  'line.import.toLibrary': [{ key: 'name', label: 'Name in the library' }, { key: 'level', label: 'Level (atom, molecule or organism)' }],
  'line.import.toFeature': [{ key: 'name', label: 'Name in the feature' }, { key: 'feature', label: 'Feature' }, { key: 'base', label: 'Based on (library item)' }],
};

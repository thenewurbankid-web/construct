export type RuleSeverity = 'error' | 'warning' | 'off';

/** One rule as `/api/validate`'s `summary` reports it (packages/core/diagnostics.mjs summarizeViolations, #758). */
export type RuleSummaryEntry = { severity: string | null; why: string | null; name: string | null; count: number };

/** One row of the Rules list, already in display form: id, plain-words name/"why", severity and live violation count. */
export type RuleRow = {
  id: string;
  name: string;
  severity: RuleSeverity;
  /** A rule's own detection intent, from a live violation's `why`; falls back to its name when it has none yet. */
  why: string;
  count: number;
};

export type RulesStatus = 'idle' | 'running' | 'ready' | 'error';

export type RulesState = {
  status: RulesStatus;
  rows: RuleRow[];
  error: string | null;
};

export type RulesAction = { type: 'RUN' } | { type: 'RESULT'; rows: RuleRow[] } | { type: 'FAIL'; error: string };

export type RulesApi = {
  state: RulesState;
  run: () => void;
};

export type RulesViewModel = {
  /** 'list' shows rows; 'empty' is a project with no rules configured (rare); 'error' is the designed failure state. */
  mode: 'list' | 'empty' | 'error';
  summary: string;
  running: boolean;
  error: string | null;
  rows: RuleRow[];
};

// #395 slice B -- one rule's severity edit, as a reviewable diff before it is saved.
export type RuleEditStatus = 'previewing' | 'ready' | 'saving' | 'error';

export type RuleEditState = {
  ruleId: string;
  severity: RuleSeverity;
  status: RuleEditStatus;
  before: string;
  after: string;
  contentHash: string;
  error: string | null;
} | null;

export type RuleEditAction =
  | { type: 'START'; ruleId: string; severity: RuleSeverity }
  | { type: 'PREVIEW_OK'; ruleId: string; before: string; after: string; contentHash: string }
  | { type: 'PREVIEW_FAIL'; ruleId: string; error: string }
  | { type: 'SAVE' }
  | { type: 'SAVE_FAIL'; error: string }
  | { type: 'CANCEL' };

export type RuleEditApi = {
  state: RuleEditState;
  start: (ruleId: string, severity: RuleSeverity) => void;
  confirm: () => void;
  cancel: () => void;
};

// #395 slice C -- scoped, time-boxed exceptions (architecture.yml `exceptions:`).
export type ExceptionRow = {
  /** Its position in architecture.yml's `exceptions:` list -- the only handle a client has to
   * remove one (exceptions carry no id of their own); only valid for the text it was read from. */
  index: number;
  path: string;
  rules: string[];
  expires: string | null;
  reason: string | null;
  expired: boolean;
};

export type ExceptionsStatus = 'idle' | 'running' | 'ready' | 'error';
export type ExceptionsState = { status: ExceptionsStatus; rows: ExceptionRow[]; error: string | null };
export type ExceptionsAction = { type: 'RUN' } | { type: 'RESULT'; rows: ExceptionRow[] } | { type: 'FAIL'; error: string };

export type NewException = { path: string; rule: string; expires: string; reason: string };

/** One exception add-or-remove, as a reviewable diff before it is saved -- same shape as RuleEditState. */
export type ExceptionEditStatus = 'previewing' | 'ready' | 'saving' | 'error';

export type ExceptionEditState = {
  kind: 'add' | 'remove';
  status: ExceptionEditStatus;
  before: string;
  after: string;
  contentHash: string;
  error: string | null;
} | null;

export type ExceptionEditAction =
  | { type: 'START'; kind: 'add' | 'remove' }
  | { type: 'PREVIEW_OK'; before: string; after: string; contentHash: string }
  | { type: 'PREVIEW_FAIL'; error: string }
  | { type: 'SAVE' }
  | { type: 'SAVE_FAIL'; error: string }
  | { type: 'CANCEL' };

export type ExceptionsApi = {
  state: ExceptionsState;
  edit: ExceptionEditState;
  addDraft: (draft: NewException) => void;
  removeAt: (index: number) => void;
  confirm: () => void;
  cancel: () => void;
};

// #395 slice D -- nonLayer/frozen glob lists (architecture.yml `nonLayer:`/`frozen:`), the "Advanced" disclosure
// #764's spec describes. Same list + add/remove-as-diff shape as exceptions, generalized over which field.
export type GlobField = 'nonLayer' | 'frozen';

export type GlobListStatus = 'idle' | 'running' | 'ready' | 'error';
export type GlobListState = { status: GlobListStatus; rows: string[]; error: string | null };
export type GlobListAction = { type: 'RUN' } | { type: 'RESULT'; rows: string[] } | { type: 'FAIL'; error: string };

export type GlobEditStatus = 'previewing' | 'ready' | 'saving' | 'error';
export type GlobEditState = {
  kind: 'add' | 'remove';
  status: GlobEditStatus;
  before: string;
  after: string;
  contentHash: string;
  error: string | null;
} | null;

export type GlobEditAction =
  | { type: 'START'; kind: 'add' | 'remove' }
  | { type: 'PREVIEW_OK'; before: string; after: string; contentHash: string }
  | { type: 'PREVIEW_FAIL'; error: string }
  | { type: 'SAVE' }
  | { type: 'SAVE_FAIL'; error: string }
  | { type: 'CANCEL' };

export type GlobListApi = {
  field: GlobField;
  state: GlobListState;
  edit: GlobEditState;
  addGlob: (glob: string) => void;
  removeAt: (index: number) => void;
  confirm: () => void;
  cancel: () => void;
};

// #395 slice 5 -- project.framework (route adapter) and features.root, read together and edited one field at a
// time. Same reducer shape as RuleEdit/GlobList, generalized to a `field` discriminator instead of a rule id.
export type ProjectSettings = { framework: string; featuresRoot: string };

export type ProjectSettingsStatus = 'idle' | 'running' | 'ready' | 'error';
export type ProjectSettingsState = { status: ProjectSettingsStatus; value: ProjectSettings | null; error: string | null };
export type ProjectSettingsAction = { type: 'RUN' } | { type: 'RESULT'; value: ProjectSettings } | { type: 'FAIL'; error: string };

export type ProjectSettingField = 'framework' | 'featuresRoot';

export type ProjectEditStatus = 'previewing' | 'ready' | 'saving' | 'error';
export type ProjectEditState = {
  field: ProjectSettingField;
  value: string;
  status: ProjectEditStatus;
  before: string;
  after: string;
  contentHash: string;
  error: string | null;
} | null;

export type ProjectEditAction =
  | { type: 'START'; field: ProjectSettingField; value: string }
  | { type: 'PREVIEW_OK'; before: string; after: string; contentHash: string }
  | { type: 'PREVIEW_FAIL'; error: string }
  | { type: 'SAVE' }
  | { type: 'SAVE_FAIL'; error: string }
  | { type: 'CANCEL' };

export type ProjectSettingsApi = {
  state: ProjectSettingsState;
  edit: ProjectEditState;
  start: (field: ProjectSettingField, value: string) => void;
  confirm: () => void;
  cancel: () => void;
};

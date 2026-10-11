export type Severity = 1 | 2 | 3;

export type Alert = { id: string; title: string; severity: Severity; read: boolean };

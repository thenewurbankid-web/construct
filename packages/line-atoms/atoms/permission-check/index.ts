// Atom permission-check (auth.permission): check whether a person may do something.
// Role-based access: a table maps each role to its permissions ("orders:read", "orders:*", or "*" for everything);
// a person has the union of their roles' permissions. Deny by default: no user, an unknown role or a missing
// permission is a denial, with the missing permissions named. A react-router loader turns a denial into a redirect.
import type { AtomMachine } from '../types.ts';

export interface User { id: string; roles: string[] }
export type RoleTable = Record<string, string[]>;

export interface PermissionState {
  status: 'unchecked' | 'allowed' | 'denied';
  user: User | null;
  table: RoleTable;
  required: string[];
  missing: string[];
}

export type PermissionEvent =
  | { type: 'CHECK'; require: string | string[]; mode?: 'all' | 'any' }
  | { type: 'SET_USER'; user: User | null };

/** Every permission a user holds through their roles. */
export function permissionsOf(user: User | null, table: RoleTable): Set<string> {
  const out = new Set<string>();
  if (user === null) {
    return out;
  }
  for (const role of user.roles) {
    for (const p of table[role] ?? []) {
      out.add(p);
    }
  }
  return out;
}

/** Whether a held permission covers a required one: equal, "*", or "<resource>:*" for any action on the resource. */
export function covers(held: string, required: string): boolean {
  if (held === '*' || held === required) {
    return true;
  }
  if (held.endsWith(':*')) {
    return required.startsWith(held.slice(0, -1));
  }
  return false;
}

/** The required permissions the user does not hold. */
export function missingPermissions(user: User | null, table: RoleTable, required: string[]): string[] {
  const held = [...permissionsOf(user, table)];
  return required.filter((r) => !held.some((h) => covers(h, r)));
}

/** Whether the user may: every required permission ("all") or at least one ("any"). */
export function can(user: User | null, table: RoleTable, required: string | string[], mode: 'all' | 'any' = 'all'): boolean {
  const list = [required].flat();
  const missing = missingPermissions(user, table, list);
  if (mode === 'any') {
    return missing.length < list.length;
  }
  return missing.length === 0;
}

export const machine: AtomMachine<PermissionState, PermissionEvent, { user: User | null; table: RoleTable }> = {
  id: 'permission-check',
  init(input) {
    return { status: 'unchecked', user: input.user, table: input.table, required: [], missing: [] };
  },
  send(state, event) {
    switch (event.type) {
      case 'CHECK': {
        const required = [event.require].flat();
        const missing = missingPermissions(state.user, state.table, required);
        let status: PermissionState['status'] = 'denied';
        if (can(state.user, state.table, required, event.mode ?? 'all')) {
          status = 'allowed';
        }
        return { ...state, status, required, missing };
      }
      case 'SET_USER':
        // A new person has not been checked yet.
        return { ...state, status: 'unchecked', user: event.user, required: [], missing: [] };
      default:
        return state;
    }
  },
  stateOf(state) {
    return state.status;
  },
};

/** One call: allowed or denied, with what is missing. */
export function checkPermission(user: User | null, table: RoleTable, required: string | string[], mode: 'all' | 'any' = 'all'): { allowed: boolean; missing: string[] } {
  const s = machine.send(machine.init({ user, table }), { type: 'CHECK', require: required, mode });
  return { allowed: s.status === 'allowed', missing: s.missing };
}

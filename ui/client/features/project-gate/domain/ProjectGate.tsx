import type { ProjectStatus } from '../types';

/** Pure predicate: does this status represent a real, usable Construct
 * project? Mirrors exactly what `status.valid` already means (see
 * ui/server's projectStatusFor — the same upward architecture.yml search
 * `getRoot` in src/cli.mjs uses to resolve every command's root), pulled
 * out as its own domain function rather than inlined so the gating
 * decision has one, testable, pure home (DOMAIN-001: no external effects
 * here, ever). */
export function isValidProject(status: ProjectStatus | null): boolean {
  return Boolean(status?.valid);
}

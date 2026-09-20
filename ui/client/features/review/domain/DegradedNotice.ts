// Pure (DOMAIN-001): the engine's `degraded` banner (#318). A change over the impact cap is summarised per
// feature instead of being declined; say which checks still ran on the whole change and which one is not
// measured, so a usable report never reads as a failure.
export function degradedNotice(degraded: { truncated?: boolean; message?: string } | null): string | null {
  if (!degraded?.message) return null;
  return degraded.truncated
    ? `${degraded.message} Rule regressions, public API changes and workflow paths still ran on the whole change. Unexplained changes are not measured.`
    : degraded.message;
}

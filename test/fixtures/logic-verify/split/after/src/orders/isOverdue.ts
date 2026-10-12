export function isOverdue(dueAt: number, now: number): boolean {
  return now > dueAt;
}

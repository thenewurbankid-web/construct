export function isOverdue(dueAt: number, now: number): boolean {
  return now > dueAt;
}

export function dueLabel(dueAt: number, now: number): string {
  return isOverdue(dueAt, now) ? 'Overdue' : 'Due';
}

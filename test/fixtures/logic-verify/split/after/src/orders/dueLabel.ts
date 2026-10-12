import { isOverdue } from './isOverdue';

export function dueLabel(dueAt: number, now: number): string {
  return isOverdue(dueAt, now) ? 'Overdue' : 'Due';
}

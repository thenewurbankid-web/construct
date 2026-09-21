// Pure (DOMAIN-001): the plan document sent to the server, and how an argument shows in its box.
import type { PlanDoc, PlanStep, Ticket } from './PlanTypes.ts';

export const argText = (value: unknown): string => {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'string') return value;
  return value === undefined ? '' : JSON.stringify(value);
};

export const buildPlan = (ticket: Ticket, steps: PlanStep[]): PlanDoc => {
  const title = ticket.title.trim() || ticket.body.trim().split('\n')[0]?.slice(0, 120) || 'Untitled note';
  return { version: 1, ticket: { source: 'text', title, ...(ticket.body.trim() ? { body: ticket.body } : {}) }, steps };
};

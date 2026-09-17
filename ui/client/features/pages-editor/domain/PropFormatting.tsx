import type { PropData } from '../types';

// Pure (DOMAIN-001) — how a prop's value is labeled/edited.

export function propLabel(p: PropData): string {
  if (p.kind === 'spread') return `{...${p.value}}`;
  if (p.kind === 'boolean' && p.value === true) return p.name;
  if (p.kind === 'string') return `${p.name}="${p.value}"`;
  return `${p.name}={${p.value}}`;
}

export function propInputKind(p: PropData): 'string' | 'number' | 'boolean' | 'expression' {
  if (p.kind === 'string' || p.kind === 'number' || p.kind === 'boolean') return p.kind;
  return 'expression'; // identifier/expression both edited as raw code
}

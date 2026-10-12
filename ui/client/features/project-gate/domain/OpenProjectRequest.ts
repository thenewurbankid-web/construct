// Pure (DOMAIN-001): what a plain request on the Your projects screen asks for, read statically (no model): start a new
// project (with its name and kind when given), bring one in from GitHub (with its link), open one of yours, or explain
// what a Line project is. Anything that looks like an access token is never read further: only the person types a
// token, in the token field.
import type { OpenProjectIntent } from '../types.ts';

const SECRET = /\b(gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,})/;
const GITHUB_URL = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+/i;
const OWNER_REPO = /(?:^|\s)([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)/;
const NAMED = /\b(?:called|named)\s+["'“]?([A-Za-z0-9][\w.-]*)/i;
const NEW_X = /\b(?:new|a|an)\s+([a-z][\w-]*)\s+(?:project|app|site|website)\b/i;
const KIND_WORDS = new Set(['line', 'react', 'next', 'nextjs', 'website', 'web', 'github', 'new', 'empty', 'small']);
const OPEN = /^\s*(?:please\s+)?(?:open|reopen|go to|switch to)\s+(?:the\s+|my\s+)?(?:project\s+)?["'“]?([^"'”]+?)["'”]?(?:\s+project)?\s*[.!?]?\s*$/i;

/** True when the text holds something that looks like an access token (it is then never kept or read further). */
export function looksLikeSecret(text: string): boolean {
  return SECRET.test(text);
}

function frameworkOf(t: string): 'line' | 'nextjs' | 'react-spa' {
  if (/\breact\b/i.test(t)) return 'react-spa';
  if (/\b(website|next\.?js)\b/i.test(t)) return 'nextjs';
  return 'line';
}

function nameOf(t: string): string | null {
  const named = NAMED.exec(t)?.[1];
  if (named) return named.replace(/[.,!?]+$/, '');
  const x = NEW_X.exec(t)?.[1];
  return x && !KIND_WORDS.has(x.toLowerCase()) ? x : null;
}

function linkOf(t: string): string | null {
  const url = GITHUB_URL.exec(t)?.[0];
  if (url) return url.replace(/[.,!?]+$/, '');
  return OWNER_REPO.exec(t)?.[1]?.replace(/[.,!?]+$/, '') ?? null;
}

function projectOf(wanted: string, projects: string[]): string | null {
  const w = wanted.trim().toLowerCase();
  return projects.find((p) => p.toLowerCase() === w) ?? projects.find((p) => w.includes(p.toLowerCase())) ?? null;
}

/** What the request asks for. `projects`: the names of the workspace's projects (for "open <name>"). */
export function readOpenProjectRequest(text: string, projects: string[]): OpenProjectIntent {
  const t = text.trim();
  if (looksLikeSecret(t)) return { kind: 'secret' };
  if (/\bwhat\b.*\bline\b|\bexplain\b/i.test(t)) return { kind: 'explain' };
  const open = OPEN.exec(t);
  if (open && !/github|new project/i.test(t)) return { kind: 'open', wanted: open[1].trim(), project: projectOf(open[1], projects) };
  if (/github|\bclone\b|\bbring\b|\bimport\b/i.test(t) || GITHUB_URL.test(t)) return { kind: 'github', link: linkOf(t) };
  if (/\b(new|start|create|make|begin)\b/i.test(t)) return { kind: 'new', name: nameOf(t), framework: frameworkOf(t) };
  if (/\b(projects|list|show)\b/i.test(t)) return { kind: 'list' };
  return { kind: 'unknown' };
}

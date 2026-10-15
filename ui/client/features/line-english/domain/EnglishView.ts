import type { EnglishState, LineEnglishFunction, LineEnglishView } from '../types';

type Answer = LineEnglishView | { ok: false; sentence: string };

/** The server's answer for `file` as the panel's state: the view, or its refusal in one sentence. */
export function englishStateOf(file: string, answer: Answer): EnglishState {
  if (answer && answer.ok === true && Array.isArray(answer.functions)) return { phase: 'ready', file, view: answer };
  const sentence = answer && answer.ok === false && answer.sentence ? answer.sentence : 'Cockpit could not read this file in English.';
  return { phase: 'error', file, sentence };
}

/** One line over the list: how many functions are read out, or why there is nothing to read. */
export function englishHeadline(view: LineEnglishView): string {
  const n = view.functions.length;
  if (n === 0) return 'This file has no top-level functions to read in English.';
  return `${n} ${n === 1 ? 'function' : 'functions'} in plain English.`;
}

/** The collapsed technical detail's label: the function's name, its line and how long its code is. */
export function detailLabel(fn: LineEnglishFunction): string {
  const lines = fn.code.split('\n').length;
  return `${fn.name}, line ${fn.line}, ${lines} ${lines === 1 ? 'line' : 'lines'} of code`;
}

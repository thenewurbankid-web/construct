// Atom csv-export (data.exportCsv): export rows as a CSV file.
// Columns are TanStack Table-style definitions (a header and an accessor). Cells are quoted per RFC 4180 (a comma, a
// quote or a line break inside a cell), and, unless turned off, a cell that starts like a spreadsheet formula
// (=, +, -, @, a tab or a carriage return) is prefixed with a quote mark so opening the file cannot run it.
import type { AtomMachine } from '../types.ts';

export interface Column<T> { header: string; accessor: keyof T | ((row: T) => unknown) }

export interface CsvOptions { separator?: string; eol?: string; safe?: boolean }

export interface CsvState {
  status: 'empty' | 'ready';
  csv: string;
  rows: number;
}

export type CsvEvent<T> = { type: 'EXPORT'; rows: T[] };

const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell as CSV text. */
export function csvCell(value: unknown, options: CsvOptions = {}): string {
  const separator = options.separator ?? ',';
  let text = '';
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (value !== null && value !== undefined) {
    text = String(value);
  }
  if ((options.safe ?? true) && FORMULA_START.test(text)) {
    text = `'${text}`;
  }
  if (text.includes(separator) || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function cellOf<T>(row: T, column: Column<T>): unknown {
  if (typeof column.accessor === 'function') {
    return column.accessor(row);
  }
  return row[column.accessor];
}

/** The whole CSV text: a header line, then one line per row. */
export function toCsv<T>(rows: T[], columns: Column<T>[], options: CsvOptions = {}): string {
  const separator = options.separator ?? ',';
  const eol = options.eol ?? '\r\n';
  const lines = [columns.map((c) => csvCell(c.header, options)).join(separator)];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(cellOf(row, c), options)).join(separator));
  }
  return lines.join(eol) + eol;
}

/** A file name such as "orders-2026-10-12.csv". */
export function csvFileName(base: string, date: Date): string {
  const slug = base.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'export'}-${date.toISOString().slice(0, 10)}.csv`;
}

export function createCsvMachine<T>(columns: Column<T>[], options: CsvOptions = {}): AtomMachine<CsvState, CsvEvent<T>, void> {
  const m: AtomMachine<CsvState, CsvEvent<T>, void> = {
    id: 'csv-export',
    init() {
      return { status: 'empty', csv: '', rows: 0 };
    },
    send(state, event) {
      if (event.type !== 'EXPORT') {
        return state;
      }
      if (event.rows.length === 0) {
        if (state.status === 'empty') {
          return state;
        }
        return m.init();
      }
      return { status: 'ready', csv: toCsv(event.rows, columns, options), rows: event.rows.length };
    },
    stateOf(state) {
      return state.status;
    },
  };
  return m;
}

/** The machine over rows of plain objects, one column per key of the first row (a quick export). */
export const machine: AtomMachine<CsvState, CsvEvent<Record<string, unknown>>, void> = {
  id: 'csv-export',
  init() {
    return { status: 'empty', csv: '', rows: 0 };
  },
  send(state, event) {
    if (event.type !== 'EXPORT') {
      return state;
    }
    const keys = Object.keys(event.rows[0] ?? {});
    return createCsvMachine<Record<string, unknown>>(keys.map((k) => ({ header: k, accessor: k }))).send(state, event);
  },
  stateOf(state) {
    return state.status;
  },
};

/** One call: the CSV text and its file name. */
export function exportCsv<T>(rows: T[], columns: Column<T>[], name: string, date: Date, options: CsvOptions = {}): { fileName: string; csv: string; mime: string } {
  return { fileName: csvFileName(name, date), csv: toCsv(rows, columns, options), mime: 'text/csv;charset=utf-8' };
}

import { readFileSync } from 'node:fs';
import { write } from '../writer/writer.js';

export function copy(from, to) {
  write(to, readFileSync(from, 'utf8'));
}

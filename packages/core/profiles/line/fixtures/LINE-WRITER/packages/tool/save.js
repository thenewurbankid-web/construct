import { writeFileSync as put } from 'node:fs';
import * as fs from 'fs';
const fsp = require('fs/promises');

export async function save(file, text) {
  put(file, text);
  fs.promises.mkdir('out', { recursive: true });
  await fsp.rename(file, `${file}.bak`);
  const { rm } = await import('node:fs/promises');
  await rm(file);
}

export const writer = { write: (s) => s };
writer.write('not a file write');

// The project's writer: the one place allowed to touch the disk (line.writers).
import fs from 'node:fs';

export function write(file, text) {
  fs.writeFileSync(file, text);
}

// A minimal, hand-rolled line reader — shared by the REPL's main loop and
// the standalone `import --route` wizard. Neither `node:readline`'s 'line'
// event (fires synchronously for every buffered line the instant piped
// input arrives, before any promise continuation gets a chance to run) nor
// `node:readline/promises`'s `question()` (only its first call reliably
// resolves against piped/non-TTY input — later calls can hang even with
// more buffered data waiting) hold up under piped input, which is exactly
// how both the REPL and the wizard get driven in tests and in scripted use.
// This sidesteps both: one line resolved at a time, strictly in order, with
// a clean `{ done: true }` on EOF instead of hanging forever.
/**
 * A minimal line reader shared by the REPL and the `import --route` wizard: one line resolved at a time, strictly in order, with `{done: true}` at end of input instead of hanging. Robust under piped input, where `node:readline` is not.
 *
 * @param {NodeJS.ReadableStream} input The input stream (usually `process.stdin`).
 * @returns {{next: () => Promise<{done:boolean, value?:string}>}} `next()` resolves the next line in order, or `{done: true}` at end of input.
 */
export function makeLineSource(input) {
  let buffer = '';
  let ended = false;
  const pendingResolvers = [];
  const lineQueue = [];
  function flushLines() {
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (pendingResolvers.length) pendingResolvers.shift()({ done: false, value: line });
      else lineQueue.push(line);
    }
  }
  input.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    flushLines();
  });
  input.on('end', () => {
    ended = true;
    if (buffer.length) {
      const line = buffer;
      buffer = '';
      if (pendingResolvers.length) pendingResolvers.shift()({ done: false, value: line });
      else lineQueue.push(line);
    }
    while (pendingResolvers.length) pendingResolvers.shift()({ done: true, value: undefined });
  });
  return {
    next() {
      if (lineQueue.length) return Promise.resolve({ done: false, value: lineQueue.shift() });
      if (ended) return Promise.resolve({ done: true, value: undefined });
      return new Promise((resolve) => pendingResolvers.push(resolve));
    },
  };
}

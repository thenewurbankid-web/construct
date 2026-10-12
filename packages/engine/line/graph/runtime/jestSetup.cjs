// G2, jest mechanism (2 of 2): a setupFilesAfterEnv file. It creates the per-test-file recorder on the sandbox's global
// (where the transformed modules find it), installs the recording fetch, names each record's test from
// expect.getState() ("<file> > <test name>") and writes the records to LINE_RUNTIME_DIR after the file's tests.
'use strict';

/* global expect, afterAll */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRecorder } = require('./recorder.cjs');

const root = process.env.LINE_RUNTIME_ROOT ?? process.cwd();
const files = new Set((process.env.LINE_RUNTIME_FILES ?? '').split(',').filter(Boolean));
const dir = process.env.LINE_RUNTIME_DIR;

const testName = () => {
  try {
    const s = expect.getState();
    return s.currentTestName ? `${path.basename(s.testPath ?? '')} > ${s.currentTestName}` : undefined;
  } catch { return undefined; }
};
const recorder = createRecorder({ test: testName });
const posix = (p) => p.split(path.sep).join('/');
recorder.isTarget = (abs) => { const rel = posix(path.relative(root, abs)); return files.has(rel) ? rel : null; };
globalThis.__lineRuntime = recorder;
recorder.installFetch(globalThis);

afterAll(() => {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  let testPath = '';
  try { testPath = expect.getState().testPath ?? ''; } catch { /* none */ }
  const name = `jest-${process.pid}-${crypto.createHash('sha1').update(testPath).digest('hex').slice(0, 10)}.json`;
  fs.writeFileSync(path.join(dir, name), JSON.stringify(recorder.records()));
});

// A jest reporter that keeps each test file's own coverage (testResult.coverage, before jest merges it), one JSON per
// test file in $LINE_CHAR_COVER_BY_FILE, so characterize.mjs can cache coverage per test file and re-run only the test
// files whose inputs changed. Reads nothing else and writes only into that folder (a temp work folder).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class FileCoverageReporter {
  constructor() {
    this.dir = process.env.LINE_CHAR_COVER_BY_FILE || '';
  }

  onTestResult(_test, testResult) {
    if (!this.dir || !testResult || !testResult.coverage) return;
    fs.mkdirSync(this.dir, { recursive: true });
    const name = crypto.createHash('sha256').update(String(testResult.testFilePath)).digest('hex').slice(0, 24);
    const coverage = typeof testResult.coverage.toJSON === 'function' ? testResult.coverage.toJSON() : testResult.coverage;
    fs.writeFileSync(path.join(this.dir, `${name}.json`), JSON.stringify({ testFilePath: testResult.testFilePath, coverage }));
  }

  getLastError() {
    return undefined;
  }
}

module.exports = FileCoverageReporter;

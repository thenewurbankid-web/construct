// A node_modules that has what a characterization test needs to run in a target app's own jest (jest, ts-jest, jsdom,
// React, React Testing Library, TypeScript): LINE_CHAR_JEST_HOME, else ~/Repositories/max-ai-ui/node_modules when
// present. Tests that run the characterizer for real link it into their temp app copy and skip, with the reason, without one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const JEST_NEEDS = Object.freeze(['jest', 'ts-jest', 'jest-environment-jsdom', 'react', 'react-dom', '@testing-library/react', 'typescript']);

/**
 * The first candidate node_modules that has every package in JEST_NEEDS, or null.
 * @returns {string|null}
 */
export function jestHome() {
  const candidates = [process.env.LINE_CHAR_JEST_HOME, path.join(os.homedir(), 'Repositories/max-ai-ui/node_modules')].filter(Boolean);
  return candidates.find((c) => JEST_NEEDS.every((n) => fs.existsSync(path.join(/** @type {string} */ (c), n, 'package.json')))) ?? null;
}

/** Why a characterization run is skipped here (one sentence). */
export const NO_JEST_HOME = 'No node_modules with jest, ts-jest, jsdom, React and React Testing Library (set LINE_CHAR_JEST_HOME).';

/**
 * Link the jest home into an app copy as its node_modules.
 * @param {string} appDir
 * @param {string} home
 * @returns {void}
 */
export function linkJestHome(appDir, home) {
  fs.symlinkSync(home, path.join(appDir, 'node_modules'), 'dir');
}

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caption, clearCaption, card, pause } from './support.mjs';

// Episode 1: "Your first project, with sign-up, login and a home page" (docs/MEDIA.md).
// Real UI interaction only. The captions below ARE the script; they are placeholders (from the storyboard)
// until the owner approves the final wording.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../../site/assets/video');
const SLUG = '01-first-project';
const WS = process.env.E2E_WORKSPACE_ROOT;

export const CAPTIONS = {
  introTitle: 'Your first project',
  introSub: 'Sign-up, login and a home page, checked against its own rules',
  signIn: 'Sign in with GitHub. Only accounts the owner allowed get in. (This recording uses the demo login.)',
  gate: 'Open a project: the Cockpit only works inside its workspace.',
  init: 'Turn the folder into a Construct project: acme.',
  create: 'Create a feature: signup, then login, then home.',
  pages: 'Pages: the three pages exist. Open home to see its structure.',
  login: 'Features: login, with its routes and layers.',
  validate: 'Check the rules: validate passes.',
  outroTitle: 'You have a project that follows its own rules',
  outroSub: 'Next: plan a change.',
};

test('episode 1: first project', async ({ page }) => {
  test.skip(!process.env.E2E_RECORD, 'skeleton: awaiting an approved script (set E2E_RECORD=1 to record)');
  fs.mkdirSync(OUT, { recursive: true });
  // TODO(recording): drive the real UI per docs/MEDIA.md, then copy the recorded video to OUT/SLUG.webm.
  void [expect, WS, SLUG, caption, clearCaption, card, pause, page];
});

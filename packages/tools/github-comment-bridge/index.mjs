#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './src/config.mjs';
import { createGitHubClient } from './src/github.mjs';
import { createJsonStore } from './src/jsonStore.mjs';
import { buildPrompt, runClaude } from './src/claudeRunner.mjs';
import { pollOnce } from './src/poller.mjs';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const stateDir = process.env.BRIDGE_STATE_DIR || path.join(toolRoot, '.state');

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function main() {
  const config = loadConfig(process.env);
  const github = createGitHubClient({ token: config.token, owner: config.owner, repo: config.repo });
  const stateStore = createJsonStore(path.join(stateDir, 'state.json'), {
    initialized: false,
    lastSeenCommentId: 0,
    lastPollIso: null,
    botLogin: null,
  });
  const sessionStore = createJsonStore(path.join(stateDir, 'sessions.json'), {});

  log(`[bridge] starting for ${config.owner}/${config.repo}`);
  log(`[bridge] repo dir: ${config.repoDir}`);
  log(`[bridge] poll interval: ${config.pollIntervalMs}ms`);
  log(`[bridge] claude binary: ${config.claudeBin}`);
  log(`[bridge] per-run timeout: ${config.runTimeoutMs}ms, max budget: ${config.maxBudgetUsd ?? '(none)'}`);
  log(`[bridge] allowed to trigger: ${config.allowedLogins.join(', ')} (this repo is public -- everyone else's /claude comments are ignored)`);
  log(`[bridge] state dir: ${stateDir}`);

  let stopping = false;
  let inFlight = false;

  async function cycle() {
    if (stopping) return;
    inFlight = true;
    try {
      await pollOnce({ github, sessionStore, stateStore, runClaudeFn: runClaude, buildPromptFn: buildPrompt, config, log });
    } catch (err) {
      log(`[bridge] poll cycle failed: ${err.stack || err.message}`);
    } finally {
      inFlight = false;
    }
    if (!stopping) {
      timer = setTimeout(cycle, config.pollIntervalMs);
    }
  }

  let timer = setTimeout(cycle, 0);

  function shutdown(signal) {
    log(`[bridge] received ${signal}, shutting down after the current cycle...`);
    stopping = true;
    clearTimeout(timer);
    if (!inFlight) process.exit(0);
    // If a claude run is mid-flight, let it finish this cycle naturally;
    // state is saved atomically at the end of each pollOnce() call, so
    // nothing is lost by exiting once it settles.
    const forceExitTimer = setTimeout(() => process.exit(0), 60_000);
    forceExitTimer.unref?.();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(`[bridge] fatal: ${err.message}`);
  process.exit(1);
});

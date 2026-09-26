**Problem.** A tool that runs commands, browses folders and writes source files is remote code execution the moment it is reachable from another machine without a login. And a tool that edits your code silently leaves you with one big uncommitted diff and no history of what happened.

It refuses to be exposed without a login, lets only the GitHub accounts you name in, and turns every save into a real git commit with a message Construct writes itself.

This page describes the Cockpit only. There is no login or commit-on-save in the CLI: the CLI runs as you, in your shell, and you commit as you always did.

## Do this

### 1. Sign in with GitHub, allowlist only

Out of the box the server binds to `127.0.0.1` and prints a loud `Authentication is OFF` banner in its console: fine for your own machine. The account button at the right of the top bar then reads "This computer" and "No sign-in on this server". Two rules keep it from being exposed by accident:

- Set `HOST` to anything that is not loopback and the process **refuses to start** unless a GitHub login is configured.
- With a GitHub OAuth app configured, login is required, always.

```bash
cd ui/server
CONSTRUCT_GITHUB_CLIENT_ID=<your OAuth app id> \
CONSTRUCT_GITHUB_CLIENT_SECRET=<your OAuth app secret> \
CONSTRUCT_ALLOWED_LOGINS=your-github-login \
CONSTRUCT_SESSION_SECRET=$(openssl rand -hex 32) \
npm start
```

`CONSTRUCT_ALLOWED_LOGINS` is required whenever OAuth is on: without it, "sign in with GitHub" would mean every GitHub account on earth. Anyone else signs in to GitHub successfully and is still refused with a `403`. Every route under `/api` answers `401` without a session, and the live wizard connection is refused at the handshake; the only public route is a health check that returns nothing else. Sessions last 8 hours by default (`CONSTRUCT_SESSION_TTL_HOURS`). Register the OAuth app at github.com/settings/developers with the callback URL `http://localhost:4000/auth/callback` (or your real host); it must match `CONSTRUCT_OAUTH_CALLBACK_URL` exactly. Never commit these values.

With login on, opening the Cockpit shows a sign-in screen with one button, **Sign in with GitHub**; a server that requires a login but has no OAuth app configured says so on that screen and names the three variables to set. Once signed in, the account button in the top bar opens a small panel with your login ("Signed in with GitHub") and **Sign out**, which ends this session only.

Limits worth knowing: the session cookie is same-site, so serve the Cockpit and its API from one origin.

### 2. Every save is a commit

Save in the Cockpit and it writes a real git commit, on a branch it creates for the session (for example `cockpit/billing-invoice-layer-a3f7`), with a message built from the change itself: how many features, layers and files it touched, what each file now does, and any wider impact or warnings. No model is involved, so the message costs nothing and works offline.

```text
CON-a3f7-0007: checkout: update ProductsPage and CheckoutController

2 features, 5 layers, 7 files
  checkout: page, controller, hook
  billing:  domain, service

Changed
  features/checkout/pages/ProductsPage.tsx (page) — Lists the catalogue with its filters.
  ...

Wider impact: 8 other file(s) import what changed, in 1 other feature(s): reporting.

Construct-Session: a3f7
Construct-Serial: 7
Construct-Summary: deterministic (construct summarize + impact); no LLM
```

(Illustrative of the format, shortened; the exact layout is specified in the project's commit-on-save doc.) The serial in the subject counts up within the branch, so parallel sessions never collide. Saves inside 30 seconds become one commit by default. Under **Settings**, **Commit on save**, you can turn it off (then the Cockpit never touches git), or set **When to commit** to **Group rapid saves** (with a **Grouping window**), **Every save**, or **Only when I click Commit** (the same message, made when you press **Commit now**). Only the files the Cockpit wrote are staged, a dirty tree at the start is something you are asked about (carry it in, or stash it), and nothing is ever pushed. A commit problem never blocks a save.

## You get

| You get | How |
|---|---|
| No accidental exposure | non-loopback `HOST` without a login refuses to start |
| Only accounts you name | allowlist; others get `403` |
| History you can read | one commit per save (or window), message written by Construct |
| No model in the message | `Construct-Summary: ... no LLM` trailer |

## Why it matters

Only people you named can reach it, and every save is a commit you can read and undo.

Checked against commit `b6f4032` on 2026-09-26 (behaviour taken from the running code and its documentation; the sign-in screen needs a real OAuth app, so it is described, not pictured).

# Builder prompt: plain arm (control, no Line)

Every plain-arm builder (qwen-7b-plain, haiku-plain, sonnet-plain) gets exactly this text, with `{{SPEC}}` replaced by
`SPEC.md` (`BENCH_DIR=bench/lending node bench/ecommerce/driver/print-prompt.mjs plain`). This is the held-out bench's copy of
`bench/ecommerce/BUILDER-PROMPT-PLAIN.md`: only the domain words differ. Same budget as the Line arm: 90 minutes of wall
time or 200 model turns, whichever comes first.

Comparability note (#889, 12 Oct): the local Line-arm builder (qwen-7b) now gets the spec's overview and a feature index
in its prompt and each feature's acceptance points in plan status, not all of SPEC.md up front. This arm has no plan
status to carry them, so it keeps the whole SPEC.md in its prompt: both arms see the same points, at different times.
Runs from before 12 Oct (pilot-qwen-7b-r2 and earlier) gave both arms the whole spec up front.

---

You are building a small lending-library web app in an existing Next.js project (app router, React 18, Tailwind CSS).

## Your only tool

`plain-cli` (environment: `BENCH_PROJECT`, `BENCH_LOG`, `BENCH_BUILDER` and `BENCH_DIR` are set for you). Run it as
`node bench/ecommerce/driver/plain-cli.mjs <command>` (a local builder gets the same commands as tool calls). Never
change project files any other way and never run anything but these commands on the project. Every call is recorded.

| Command | What it does |
| --- | --- |
| `ls [dir]` | the entries of one folder |
| `tree [dir]` | every file under a folder |
| `read <path>` | one file |
| `write <path>` (content on stdin, or `--content "<text>"`) | create or replace one file |
| `run build` / `run lint` / `run tsc` | `npm run <script>` in the project; output tail and exit code |

## What is there

- `app/layout.tsx` (root layout with the Toast provider) and `app/globals.css`; no route yet.
- `components/ui/`: Button, TextField, Card, Dialog, Select, Checkbox, Toast (Radix UI and Tailwind).
- `components/layouts/`: ListPage, DetailPage, FormPage.
- `lib/workflows/`: listDetail, checkout (xstate); `lib/books.json`: the 15 books.

Client components need `'use client';` as their first line.

## When to stop

Stop when every acceptance point below is done, or when the budget ends (90 minutes or 200 turns). Before you stop,
run `run build` and `run tsc`. Then write a short summary: what you built and which points you think pass.

## The spec

{{SPEC}}

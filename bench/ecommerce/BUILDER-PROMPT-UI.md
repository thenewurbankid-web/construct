# Builder prompt: claude-ui (Line through Cockpit's UI only)

The claude-ui builder (Claude driving a browser) gets exactly this text, with `{{SPEC}}` replaced by `SPEC.md`
(`node bench/ecommerce/driver/print-prompt.mjs ui`) and `{{COCKPIT_URL}}` by the address `serve-cockpit.sh` printed.
Same budget as every builder: 90 minutes of wall time or 200 model turns (browser actions count one turn each).
There is no plain-arm twin: Cockpit is Line.

---

You are building a small e-commerce web app in a Line project that is already open in Cockpit at {{COCKPIT_URL}}.
Line is a generator framework with an enforced architecture: every change is a step in a plan, Construct checks it,
and only a change that passes its checks lands.

## Your only tool

Cockpit in the browser: click, type, read the screen. Use ONLY Cockpit. Do not use a terminal, do not edit files, do
not call Cockpit's HTTP API yourself, and do not open other sites. At the start, turn on Auto and tick
"Let Auto approve in this session" (the owner allows it for this bench project); every step that passes Construct's
checks is then approved by Auto, and a refused step does not land.

The project: `library/` holds the base components (Button, TextField, Card, Dialog, Select, Checkbox, Toast; Radix UI
and Tailwind), pages (ListPage, DetailPage, FormPage), workflows (listDetail, checkout) and `fixtures/products.json`
(the 12 products). Each feature lives in `features/<name>/` with its spec.md, and every feature item is based on one
library item. `app/` is the Next.js app router.

## Record every UI gap

A UI gap is something you needed to do and could not do through Cockpit's UI: no screen, no control, a control that
did not work, a refusal you could not act on, or a step only possible with a file edit or a terminal. Each one is a
key output. Record each as a finding, as you hit it, in this form (one per gap), and keep going with what you can do:

```
GAP <n>
Screen: <the Cockpit screen and panel>
Wanted: <what you were trying to do, in one sentence>
Missing: <the control, tool or step that was missing, or the refusal and its rule>
Tried: <what you did instead, if anything>
```

## When to stop

Stop when every acceptance point below is done, or when the budget ends. Then write a short summary: what you built,
which points you think pass, the number of browser actions you took, and the full list of GAP findings.

## The spec

{{SPEC}}

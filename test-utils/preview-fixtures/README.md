# Preview fixtures (#443)

Two tiny real apps used to exercise the live-preview v2 bridge and resolver
(`packages/engine/previewFiber.mjs`) against **real dev builds**, plus the script
that records payloads from them.

| Fixture | Framework | Runnable in this repo today |
|---|---|---|
| `next-app/` | Next.js App Router (client component) | **yes** — `next` is installed under `ui/client/node_modules` |
| `vite-app/` | Vite + React | **no** — Vite is not installed anywhere in this repo, and #443 forbids installing frameworks for this. Its sources are checked in so it runs the moment a Vite toolchain exists (slice 5). |

Neither fixture installs anything of Construct's: that is the point of v2. They
are ordinary apps, and the bridge reaches them from the outside.

## Recording a payload from a real dev build

`capture.mjs` starts nothing itself. Start the app first, then point the script
at it. It drives Chromium (the one `ui/e2e` already has), installs the bridge
against a stand-in window object, Alt+clicks an element, and writes the
resulting payload — plus any source map it could fetch — to
`test/fixtures/previewFiber/`.

```sh
# 1. a scratch copy of the fixture with node_modules borrowed from ui/client
cp -r test-utils/preview-fixtures/next-app /tmp/cx-next && \
  ln -s "$PWD/ui/client/node_modules" /tmp/cx-next/node_modules

# 2. its dev server, on a port from this repo's agent range
(cd /tmp/cx-next && PORT=3851 ./node_modules/.bin/next dev -p 3851) &

# 3. record
packages/tools/dev/heavy.sh node test-utils/preview-fixtures/capture.mjs \
  --url http://127.0.0.1:3851/ --name next-dev --selector '[data-testid="cta"]'
```

The recorded files carry a `capturedFrom` block saying exactly which versions
and which URL produced them, so a payload can never be mistaken for a
hand-written one. `test/previewFiber.recorded.test.mjs` runs the resolver over
whatever is recorded and skips cleanly when nothing is.

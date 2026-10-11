# Line sample

A small Line project for trying Cockpit: a library and two features (orders, billing).
It has two planted mistakes, so Cockpit has something to explain:

1. `features/billing/pages/InvoicesPage.tsx` imports `OrderButton` from the orders feature
   (LINE-DIR: a feature may use only the library).
2. `features/billing/components/InvoiceCard.tsx` has no `@line-base` link to a library item
   (LINE-BASE: every feature item is based on one library item).

Check it from the command line (from the repo root):

    node packages/cli/construct.mjs validate --dir examples/line-sample

Open it in Cockpit: copy it into the Cockpit workspace (`cp -R examples/line-sample ~/workspace/`)
and pick `line-sample` in the project picker.

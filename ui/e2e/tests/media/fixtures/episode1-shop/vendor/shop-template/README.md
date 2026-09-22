# vendor/shop-template

Layout, class names and colour palette adapted from Start Bootstrap's **"Shop Homepage"** and
**"Shop Item"** templates (MIT licensed, `LICENSE` in this directory — fetched from
`github.com/StartBootstrap/startbootstrap-shop-homepage` and
`github.com/StartBootstrap/startbootstrap-shop-item` and verified 2026-09-22, `"license": "MIT"`
in each template's own `package.json`).

`../../features/catalog/pages/ShopHome.tsx` and `../../features/catalog/pages/shop-template.css`
are a hand-written TypeScript/CSS port of that layout — no build step or copied source file from
either npm package — kept on the template's own literal colours (a warm cream/navy/terracotta
palette) rather than Cockpit's design tokens, because this page is meant to read as *someone
else's app*, wrapped, not restyled. See `architecture.yml`'s `frozen:` list and README.md's
"Wrapping frozen, externally-authored UI" section in the Construct repository.

This directory exists so the licence and its notice travel with the code that used it, per
CLAUDE.md's "embrace open source" rule — it is not itself imported by any TypeScript file.

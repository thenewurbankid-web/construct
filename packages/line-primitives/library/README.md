# Line primitives library

The canonical primitives every Line feature can build on: complete, accessible components re-implemented on Radix + Tailwind (no library code copied). A feature item is based on one of these through its `@line-base components/<Name>` link.

- Each primitive implements its entry in `../contract.mjs`: states, events, parts, keyboard map, accessibility and props.
- Variant hook-points: every primitive sets `data-variant` / `data-size` (and `data-side` where it has a side) and takes `className`, so theming (roadmap item 8) can map them to tokens.
- Tailwind: add `library/**/*.tsx` to the app's Tailwind `content` paths. The classes use Tailwind's default palette (slate, red, green, amber, blue) and `sr-only`.

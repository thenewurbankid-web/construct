# bench-ecommerce (Line arm)

A Line project (Next.js app router, Tailwind, Radix UI base components) for the e-commerce bench. `library/` holds the base components, pages, workflows and the product fixtures; `features/<name>/` holds one feature each, with its spec.md; `app/` holds only the root layout and route entries (`export { Page as default } from '<feature page>'`); `line/` is Line's own state.

Check it: `construct validate --dir . --profile line`. Change it only through `bench/ecommerce/driver/plan-cli.mjs`.

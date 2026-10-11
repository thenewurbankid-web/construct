# Line held-out project (clinic)

A second small Line project, used only to score the System 1 drafter on a project it was not designed on
(`packages/engine/line/drafter/eval`). A library and two features (patients, visits), with two planted mistakes:

1. `features/visits/pages/VisitsPage.tsx` imports `PatientRow` from the patients feature (LINE-DIR).
2. `features/visits/components/VisitPill.tsx` has no `@line-base` link (LINE-BASE).

    node packages/cli/construct.mjs validate --dir examples/line-heldout-clinic --profile line

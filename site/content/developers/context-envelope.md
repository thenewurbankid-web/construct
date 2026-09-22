A **Context Envelope** is the plain-JSON state handed between generator steps, so a script (or a model) driving a multi-step build never has to re-derive what already exists. Each step reads the envelope from the previous step and returns an updated one.

The schema of record is [`schemas/envelope.v1.json`](/schemas/envelope.v1.json). `packages/engine/envelope.mjs` builds and structurally validates envelopes (`createEnvelope`, `validateEnvelope`); a test reads the schema's own `required` list so the two cannot drift.

## Shape

| Field | Meaning |
|---|---|
| `version` | Always `1`. A breaking change ships as a new schema file, not a mutation of v1. |
| `feature` | The feature (`features/<feature>/...`) this envelope tracks. |
| `status` | `pending` on the way in; `committed` or `aborted` on the way out. |
| `layers` | Map of layer name to the project-relative files that layer owns so far. |
| `unboundSlots` | Interactive props found on an ingested page that have no handler wired yet. |
| `events` | XState event types exposed by the feature's workflow. |
| `diagnostics` | Violations found when the step's output was validated. |
| `steps` | Input only: `[{ layer, name }]` generator steps to run. Cleared on output. |

## Running a pipeline

`construct pipeline run` reads an envelope from standard input, renders every requested step, stages all files in one transaction and validates the combined result with the same enforcers `construct validate` uses. Either every file lands or none do: there is no half-applied run. The resulting envelope is printed as JSON.

```bash
echo '{"version":1,"feature":"billing","status":"pending","layers":{},
       "steps":[{"layer":"domain","name":"Invoice"},{"layer":"service","name":"fetchInvoice"}]}' \
  | construct pipeline run --dir my-app
```

Real output:

```json
{
  "version": 1,
  "feature": "billing",
  "status": "committed",
  "layers": {
    "domain": ["features/billing/domain/Invoice.tsx"],
    "service": ["features/billing/services/FetchInvoice.tsx"]
  },
  "unboundSlots": [],
  "events": [],
  "diagnostics": []
}
```

If validation fails, nothing is written, `status` is `aborted`, `diagnostics` lists why, and the process exits non-zero (`1` for rule violations). Malformed input exits with `2`.

## Where the pieces are

| Piece | File |
|---|---|
| Runner | `packages/engine/pipeline.mjs` (`runPipeline`) |
| Atomic writes | `packages/engine/transactionalWriter.mjs` (`createTransaction`) |
| Envelope helpers | `packages/engine/envelope.mjs` |
| Page ingestion, workflow generation, controller binding | `packages/engine/pageTransformer.mjs`, `workflowGenerator.mjs`, `controllerBinder.mjs` |

Each of the zero-LLM generators can feed the envelope: ingest a page and record its unbound slots, generate a workflow from a state descriptor, then bind the controller. The envelope carries what one step learned to the next as a concrete example rather than a specification to re-interpret.

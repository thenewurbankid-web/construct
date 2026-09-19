Use `create` to scaffold files in the right layer with the right names. Nothing is written by an AI model unless you add `--llm`.

## A feature, a layer, or a slice

```bash
# an empty feature with all layer folders
construct create feature billing

# one file in one layer
construct create domain PriceCheck --feature billing

# several layers of one logical unit in a single command
construct create layer Invoice --feature billing --layers domain,hook,page,controller
```

Real output of the last command:

```text
Created features/billing/domain/Invoice.tsx (0.02s)
Created features/billing/hooks/useInvoice.tsx (0.00s)
Created features/billing/pages/InvoicePage.tsx (0.00s)
Created features/billing/controllers/InvoiceController.tsx (0.00s)
Total: 0.03s
[tool: scaffolded the file(s) above from templates] [llm: 0 calls — filling in the logic is a separate step, by you or whichever LLM you choose]
```

The layers are `domain`, `service`, `workflow`, `hook`, `component`, `page` and `controller`. List them in any order; Construct builds them in dependency order.

{{include README.md#Build order is enforced, not a convention to remember level=2 nohead}}

## Generate a network layer from an OpenAPI spec

{{include README.md#Service generator: OpenAPI -> RTK Query level=3 nohead}}

## Next

Run `construct validate` to check the result, and see [Tune the rules](@user-guide/how-to/tune-rules/) if a rule does not suit your project.

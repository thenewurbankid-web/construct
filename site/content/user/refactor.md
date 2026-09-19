`refactor` moves or renames a file inside the architecture and rewrites every import that pointed at it. It never changes what is inside the file.

```bash
# move a file to a different layer
construct refactor move Invoice --feature billing --from domain --to service

# rename a file within its layer
construct refactor rename Invoice Bill --feature billing --layer domain
```

Real output of the move:

```text
Moved features/billing/domain/Invoice.tsx -> features/billing/services/Invoice.tsx (0 importer(s) updated)
[tool: relocated/renamed the file and rewrote every importer's path] [llm: 0 calls — content and the exported identifier are untouched]
```

Whether the file is *valid* in its new layer (naming, purity, and so on) is `construct validate`'s job. Run it right after the move so a mismatch shows up immediately. A file matched by a `frozen:` glob is never moved or rewritten.

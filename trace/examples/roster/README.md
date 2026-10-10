# roster — ties that carry over (never guessed)

**Scenario.** In the mock data `lead` equals `deputy`, and `budget` equals `forecast`, in every row. So:
- the **Owner** and **Backup** columns are each tied between `lead` and `deputy`;
- the **planned** and **forecast** totals are each tied between `sum(budget)` and `sum(forecast)`.

**What the tool does.** It asks about all four; it never decides for you. The second question of each pair
carries a plain note, for example *"lead" is already used by "row.owner". This part is still yours to decide.*
That is information, not an inference: nothing is filled in until you answer. If you really want both columns
to show `lead`, say so.

**Questions asked:** 4 · **Open items in Auto mode:** 4, each with a hint saying which field to change in which row.

**Close them with data instead.** In `openapi.json` change `deputy` in one row (say Apollo's to "Prerna"),
and `forecast` in one row. With Watch on, the ties disappear on the next re-run and nothing is asked: the mock
data now tells the fields apart, so the match is evidence, not a guess.

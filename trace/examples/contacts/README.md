# contacts — build the missing pieces yourself (placeholders)

**Scenario.** The design shows things the API does not hand over ready-made. This is what the
**"something else — build a placeholder…"** option is for.

| Design part | Why the tool can't match it | What you can answer |
|---|---|---|
| **Name** `Lena Kumar` | No single field holds it; the API has `first` and `last`. | *Combine values from API fields* → pick `first` and `last`, name the function (e.g. `fullName`). You get a placeholder in the Domain layer that receives both. |
| **Initials** `LK` | Not in the API at all. | *Provided by the controller* → a placeholder function in the Controller. |
| **Directory updated** `26 Sep 2026` | Not in the API, and it isn't derived from the list. | *A new API endpoint that doesn't exist yet* → a placeholder call in the Service, wired into the Controller. |
| **Call** button | Not a known verb. | Name your own handler → a placeholder handler in the Controller. |

**Questions asked:** 4 · **Open items after answering:** 4 placeholders (violet in the tree), each listed with what to fill in.

**Try it:** press **Start** and answer with placeholders. Or press **Skip for now** on one of them: it stays amber and is asked again next time.

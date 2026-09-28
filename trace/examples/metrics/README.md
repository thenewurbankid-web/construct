# metrics — values only (no list, no buttons)

**Scenario.** A dashboard header with no table and no form. Every number is an aggregate of the list the API returns:

| Design | Computed as |
|---|---|
| `4` | count of items |
| `$364.0M` | sum of `revenue`, shown as compact money |
| `$120.0M` | max of `revenue` |
| `$33.0M` | min of `cost` |
| `18.5%` | average of `conversion`, shown as a percent |
| `26 Sep 2026` | *nothing* — a date isn't an aggregate of the list |

**Questions asked:** 1 (`asOf`) · **Open items:** 1 in Auto mode, with a hint (add the data as a field, or answer with a controller
placeholder or a new endpoint).

This is the example to read to see which transforms exist: `count`, `sum`, `average`, `min`, `max`, and the formats
`asText`, `moneyCompact`, `moneyFull`, `percent`, `dateShort`. Add your own in `src/transforms.mjs`.

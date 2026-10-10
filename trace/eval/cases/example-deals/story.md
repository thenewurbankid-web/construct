# Deals — requirements

## Goal

As someone managing deals, I want to see each deal's owner, CSM, contact and stage sorted by largest value first, with a weighted pipeline total, so that I can prioritize the deals worth the most.

## Acceptance criteria

- The Owner column shows the salesperson who owns the deal.
- The CSM column shows the customer success manager, who takes over after the deal is won.
- The Contact column shows the customer contact's first and last name together, separated by a space.
- Deals are listed with the largest value first.
- The Stage column comes from a deal stage that the backend does not provide yet.
- The Forecast button opens a forecasting view that we have not built, so it uses a handler of our own.
- The weighted pipeline is the sum, over all deals, of the deal value times its margin.
- The header shows when the data was last synced; the controller supplies this.

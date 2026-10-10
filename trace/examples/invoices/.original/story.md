# Invoices — requirements

- Each invoice records who requested it (the requester) and who approves it (the assignee).
- The list shows the person who requested each invoice, in the "Requested by" column.
- Invoices are listed with the largest amount first.
- The header shows the largest invoice amount.
- Archiving an invoice has no backend support yet, so the Archive button uses a handler of our own.
- The Status column comes from a status the backend does not provide yet.
- The header shows when the data was last synced; the controller supplies this.

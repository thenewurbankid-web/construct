# loans

## As a member, I want to see and manage my loans, so that I can keep them, move them or give them back

- LN-1: The page at `/loans` has the main heading "My loans" and shows each loan with its loan number, its titles, its pickup branch, its return-by date and the status "Ready for pickup"; the loans are kept when the page is reloaded, and with none it says "You have no loans".
- LN-2: A "Renew" button on a loan moves its return-by date 14 days later; a loan can be renewed only once, after which it says "Renewed" and its "Renew" button is gone or disabled.
- LN-3: A "Change branch" button on a loan lets the member pick another pickup branch (a choice labelled "Pickup branch") and press "Save"; the loan then shows the new branch.
- LN-4: A "Cancel loan" button asks "Cancel this loan?" with the buttons "Yes, cancel" and "Keep it"; "Keep it" changes nothing, and "Yes, cancel" removes the loan and makes its books available again.

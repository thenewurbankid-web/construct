# request

## As a member, I want to request my picks for pickup, so that the library sets them aside for me

- REQ-1: The page at `/request` has the main heading "Request books", lists the picked titles and the return-by date, and has fields labelled "Name", "Library card number" and "Email" and a choice labelled "Pickup branch" (Central, Riverside or Hillview).
- REQ-2: Pressing "Send request" with a missing or wrong value sends nothing and shows a message for each problem ("Enter your name", "A card number is 2 letters and 6 digits, like AB123456", "Enter a valid email", "Choose a pickup branch"); each text field with a problem is marked invalid (aria-invalid).
- REQ-3: With every value valid, "Send request" creates the loan through a mock loan service, empties the picks, marks the requested books "On loan" and opens `/request/done`.
- REQ-4: The page at `/request/done` has the main heading "Request received" and shows the loan number (text starting "Loan #"), the requested titles, the pickup branch and the return-by date, with a link "See my loans" to `/loans`.
- REQ-5: Opening `/request` with no picks says "You have not picked any books yet" and links back to the catalogue, instead of the form.

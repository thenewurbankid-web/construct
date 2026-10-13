# Lending library MVP

A small web app for the members of a neighbourhood lending library. A member looks through the catalogue, opens a
book, keeps a short list of picks, requests them for pickup at a branch, and then manages their loans (renew, change
the branch, cancel). There is no backend and no sign-in: the books come from the fixture file, the member's picks and
loans live in the browser (localStorage), and sending a request calls a mock loan service in the app (no network).

Stack (already in the starter): Next.js app router, React 18, Tailwind CSS, base components on Radix UI primitives
(Button, TextField, Card, Dialog, Select, Checkbox, Toast) and base pages (ListPage, DetailPage, FormPage). Books: the
fixture file `library/fixtures/books.json` with 15 books in 3 genres (Fiction, History, Science), 5 each. Each book
has an id, a title, an author, a genre, a publication year, a page count, a one-line summary and `available` (two
books start out on loan). Dates are shown as `YYYY-MM-DD` in the member's local time, for example `2026-11-03`.

A book is "On loan" when the fixture says so or when it is part of one of the member's loans; otherwise it is
"Available".

Routes (the acceptance tests open these URLs):

| Route | Feature | Page |
| --- | --- | --- |
| `/` | browse | the catalogue |
| `/books/<id>` | book | one book (`<id>` is the fixture id, e.g. `glass-harbour`) |
| `/picks` | picks | the member's picks |
| `/request` | request | the request form |
| `/request/done` | request | the request confirmation |
| `/loans` | loans | the member's loans |

Each feature below is one user story; each numbered item is one acceptance point. The acceptance tests in
`acceptance/` check each point by its id (for example `BRW-2`) through the page's roles, labels and visible text.

## As a member, I want to look through the catalogue, so that I can find something to read (feature `browse`)

1. BRW-1: The page at `/` has the main heading "Library catalogue" and shows the books six at a time, each with its title, its author, its genre, its year and "Available" or "On loan"; each title is a link to the book's page at `/books/<id>`.
2. BRW-2: Under the list, a line like "Page 1 of 3" and two buttons, "Previous page" and "Next page", move through the pages; "Previous page" is disabled on the first page and "Next page" on the last.
3. BRW-3: A control labelled "Sort by" orders the books by "Title A-Z" (the default), "Newest first" or "Oldest first" (by year).
4. BRW-4: A control labelled "Genre" offers All genres, Fiction, History and Science; picking a genre shows only that genre's books and goes back to the first page, and All genres shows every book again.
5. BRW-5: A text box labelled "Find a book" keeps only the books whose title or author contains what was typed, ignoring case, and works together with the genre; when nothing is left the page says "No books match your search".

## As a member, I want to read about a book and pick it, so that I can borrow it later (feature `book`)

1. BK-1: The page at `/books/<id>` has the book's title as its main heading and shows "by <author>", its genre, its year, its page count (like "312 pages") and its summary.
2. BK-2: An available book has an "Add to my picks" button; pressing it adds the book to the member's picks and a status message says "Added to your picks".
3. BK-3: A book that is on loan says "On loan" and cannot be picked (no "Add to my picks" button, or a disabled one); a book that is already picked says "Already in your picks" and cannot be picked again.
4. BK-4: Every book page has a link "Back to the catalogue" to `/`; an unknown id shows "We could not find that book" and the same link.

## As a member, I want a short list of the books I picked, so that I can request them together (feature `picks`)

1. PCK-1: Every page shows a link whose name starts with "My picks" followed by the number of picked books in brackets, like "My picks (2)"; it opens `/picks`.
2. PCK-2: The page at `/picks` has the main heading "My picks" and lists each picked book with its title and author and a button "Remove <title>" that takes it off the list.
3. PCK-3: A member can pick at most 4 books: with 4 picked, pressing "Add to my picks" on another book shows "You can pick up to 4 books" and leaves the picks as they were.
4. PCK-4: The page shows the "Loan length" and the "Return by" date: the loan length is 21 days for 1 or 2 books and 14 days for 3 or 4 books, and the return-by date is today plus the loan length.
5. PCK-5: With no picks, the page says "You have not picked any books yet" and offers no way to request.
6. PCK-6: The picks are kept when the page is reloaded, and a link "Request these books" opens `/request`.

## As a member, I want to request my picks for pickup, so that the library sets them aside for me (feature `request`)

1. REQ-1: The page at `/request` has the main heading "Request books", lists the picked titles and the return-by date, and has fields labelled "Name", "Library card number" and "Email" and a choice labelled "Pickup branch" (Central, Riverside or Hillview).
2. REQ-2: Pressing "Send request" with a missing or wrong value sends nothing and shows a message for each problem ("Enter your name", "A card number is 2 letters and 6 digits, like AB123456", "Enter a valid email", "Choose a pickup branch"); each text field with a problem is marked invalid (aria-invalid).
3. REQ-3: With every value valid, "Send request" creates the loan through a mock loan service, empties the picks, marks the requested books "On loan" and opens `/request/done`.
4. REQ-4: The page at `/request/done` has the main heading "Request received" and shows the loan number (text starting "Loan #"), the requested titles, the pickup branch and the return-by date, with a link "See my loans" to `/loans`.
5. REQ-5: Opening `/request` with no picks says "You have not picked any books yet" and links back to the catalogue, instead of the form.

## As a member, I want to see and manage my loans, so that I can keep them, move them or give them back (feature `loans`)

1. LN-1: The page at `/loans` has the main heading "My loans" and shows each loan with its loan number, its titles, its pickup branch, its return-by date and the status "Ready for pickup"; the loans are kept when the page is reloaded, and with none it says "You have no loans".
2. LN-2: A "Renew" button on a loan moves its return-by date 14 days later; a loan can be renewed only once, after which it says "Renewed" and its "Renew" button is gone or disabled.
3. LN-3: A "Change branch" button on a loan lets the member pick another pickup branch (a choice labelled "Pickup branch") and press "Save"; the loan then shows the new branch.
4. LN-4: A "Cancel loan" button asks "Cancel this loan?" with the buttons "Yes, cancel" and "Keep it"; "Keep it" changes nothing, and "Yes, cancel" removes the loan and makes its books available again.

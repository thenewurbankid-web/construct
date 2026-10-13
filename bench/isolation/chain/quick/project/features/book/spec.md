# book

## As a member, I want to read about a book and pick it, so that I can borrow it later

- BK-1: The page at `/books/<id>` has the book's title as its main heading and shows "by <author>", its genre, its year, its page count (like "312 pages") and its summary.
- BK-2: An available book has an "Add to my picks" button; pressing it adds the book to the member's picks and a status message says "Added to your picks".
- BK-3: A book that is on loan says "On loan" and cannot be picked (no "Add to my picks" button, or a disabled one); a book that is already picked says "Already in your picks" and cannot be picked again.
- BK-4: Every book page has a link "Back to the catalogue" to `/`; an unknown id shows "We could not find that book" and the same link.

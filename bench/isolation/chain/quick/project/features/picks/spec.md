# picks

## As a member, I want a short list of the books I picked, so that I can request them together

- PCK-1: Every page shows a link whose name starts with "My picks" followed by the number of picked books in brackets, like "My picks (2)"; it opens `/picks`.
- PCK-2: The page at `/picks` has the main heading "My picks" and lists each picked book with its title and author and a button "Remove <title>" that takes it off the list.
- PCK-3: A member can pick at most 4 books: with 4 picked, pressing "Add to my picks" on another book shows "You can pick up to 4 books" and leaves the picks as they were.
- PCK-4: The page shows the "Loan length" and the "Return by" date: the loan length is 21 days for 1 or 2 books and 14 days for 3 or 4 books, and the return-by date is today plus the loan length.
- PCK-5: With no picks, the page says "You have not picked any books yet" and offers no way to request.
- PCK-6: The picks are kept when the page is reloaded, and a link "Request these books" opens `/request`.

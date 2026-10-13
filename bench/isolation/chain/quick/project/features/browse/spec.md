# browse

## As a member, I want to look through the catalogue, so that I can find something to read

- BRW-1: The page at `/` has the main heading "Library catalogue" and shows the books six at a time, each with its title, its author, its genre, its year and "Available" or "On loan"; each title is a link to the book's page at `/books/<id>`.
- BRW-2: Under the list, a line like "Page 1 of 3" and two buttons, "Previous page" and "Next page", move through the pages; "Previous page" is disabled on the first page and "Next page" on the last.
- BRW-3: A control labelled "Sort by" orders the books by "Title A-Z" (the default), "Newest first" or "Oldest first" (by year).
- BRW-4: A control labelled "Genre" offers All genres, Fiction, History and Science; picking a genre shows only that genre's books and goes back to the first page, and All genres shows every book again.
- BRW-5: A text box labelled "Find a book" keeps only the books whose title or author contains what was typed, ignoring case, and works together with the genre; when nothing is left the page says "No books match your search".

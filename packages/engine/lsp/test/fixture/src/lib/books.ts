export type Book = { id: string; title: string; author: string; pages: number };

export const shelf: Book[] = [{ id: 'a', title: 'Alpha', author: 'Ann', pages: 10 }];

export function findBook(id: string): Book | undefined {
  return shelf.find((b) => b.id === id);
}

export function pageLabel(book: Book, suffix = 'pages'): string {
  return `${book.pages} ${suffix}`;
}

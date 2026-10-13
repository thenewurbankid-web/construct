import { findBook } from '../lib/books';

export function describe(id: string): string {
  const book = findBook(id);
  if (!book) return 'missing';
  return `${book.title} by ${book.author}, ${pageLabel(book)}`;
}

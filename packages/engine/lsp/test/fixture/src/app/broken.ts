import { findBook } from '../lib/books';

export function count(id: string): number {
  const book = findBook(id);
  return book ? book.pagez : shelf.length;
}

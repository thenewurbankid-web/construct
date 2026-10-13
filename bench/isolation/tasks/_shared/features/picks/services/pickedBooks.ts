// Picked-books service (#943, read-only context): the picks page turns picked ids into books only through this function.
import { defineService } from '@line/construct-core/typed-contracts';
import books from '../../../library/fixtures/books.json';

export type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

/** The books for these ids, in the order of the ids; an id with no book is skipped. */
export const pickedBooks = defineService('pickedBooks', ({ ids }: { ids: string[] }): Book[] =>
  ids.map((id) => (books as Book[]).find((b) => b.id === id)).filter((b): b is Book => b !== undefined));

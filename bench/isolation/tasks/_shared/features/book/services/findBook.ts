// Book service (#943, read-only context): the book page reads a book only through this function, never the fixture.
import { defineService } from '@line/construct-core/typed-contracts';
import books from '../../../library/fixtures/books.json';

export type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

/** The book with this id, or undefined when there is none. */
export const findBook = defineService('findBook', ({ id }: { id: string }): Book | undefined => (books as Book[]).find((b) => b.id === id));

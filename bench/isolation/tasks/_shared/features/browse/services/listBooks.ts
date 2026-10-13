// Catalogue service (#943, read-only context): the browse page reads the books only through this function.
import { defineService } from '@line/construct-core/typed-contracts';
import books from '../../../library/fixtures/books.json';

export type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

/** Every book in the catalogue, in fixture order (a new array each call). */
export const listBooks = defineService('listBooks', (_props: Record<string, never>): Book[] => [...(books as Book[])]);

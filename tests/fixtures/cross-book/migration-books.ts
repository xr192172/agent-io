import fs from 'node:fs';

/**
 * Single-authority loader for the immutable migration book snapshot.
 * The JSON file is the only content carrier; this module only loads and verifies it.
 */
const here = import.meta.url;
const jsonUrl = new URL('./migration-books.json', here);
const raw = fs.readFileSync(jsonUrl, 'utf8');
const snapshot = JSON.parse(raw) as { books: Record<string, unknown> };
if (!snapshot.books || typeof snapshot.books !== 'object') {
  throw new Error('migration-books.json 缺 books 对象（历史夹具不可读）');
}
export const MIGRATION_BOOKS = snapshot.books;

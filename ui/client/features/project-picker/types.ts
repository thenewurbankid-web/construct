/** What a pick wants (#600): a route (folder with a page, or a code file) or any folder. */
export type PathExpectation = 'route' | 'dir';

/** One row of the project picker, as ui/server's GET /api/project/tree returns it. */
export type ProjectTreeEntry = { name: string; path: string; kind: 'dir' | 'file'; route: boolean };

export type ProjectTree = { path: string; parent: string | null; entries: ProjectTreeEntry[]; truncated?: boolean };

// Pure (DOMAIN-001) — the `data-cx-src="file:line:col"` value written by the core annotator.
export type CxSrc = { file: string; line: number; column: number };

/** Same contract as the core's `parseCxSrc`: split from the right, file may contain ':'. */
export function parseCxSrc(value: unknown): CxSrc | null {
  const m = /^(.*):(\d+):(\d+)$/.exec(String(value ?? ''));
  return m ? { file: m[1], line: Number(m[2]), column: Number(m[3]) } : null;
}

/** Does the annotated file path (project-root-relative) denote the open page? */
export function isOpenPage(srcFile: string, feature: string, file: string): boolean {
  const norm = srcFile.replace(/\\/g, '/');
  return norm === `features/${feature}/pages/${file}` || norm.endsWith(`/${feature}/pages/${file}`);
}

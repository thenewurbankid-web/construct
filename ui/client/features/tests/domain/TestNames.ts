// Pure (DOMAIN-001): turning what a person types into a test file name. The SERVER re-validates the name
// (^[a-z0-9][a-z0-9-]*$); this only makes a good one.
const MAX_NAME = 80;

/** "Refund over £50 goes to manual review" -> "refund-over-50-goes-to-manual-review". '' when nothing usable is left. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME)
    .replace(/-+$/, '');
}

/** Where the clone will be saved, exactly as the server derives it. */
export const clonePath = (feature: string, name: string): string => `features/${feature}/tests/${slugify(name)}.spec.ts`;

/** The default name offered in the dialog. */
export const defaultCloneName = (title: string): string => `${title} copy`;

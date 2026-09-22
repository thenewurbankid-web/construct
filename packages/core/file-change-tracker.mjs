// In-memory "last known content" store that turns a stream of observed file
// contents into per-file change records (#224). Pure and I/O-free: callers
// pass content in (a poll, a file-watch event, an editor save) so it is
// trivially testable and swappable. Content changes the tracker did not
// `adopt` are, by definition, external (an agent, the CLI, another editor).
import crypto from 'node:crypto';

const hashOf = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Create an in-memory tracker that tells apart changes made by the Cockpit user from changes made by anything else (an agent, the CLI, another editor): content it `observe`s that differs from the last known snapshot is an external change; content it `adopt`s is the user's own.
 *
 * @param {{now?: () => number}} [options] Clock, injected for tests.
 * @returns {{observe:(key:string, content:string) => object|null, adopt:(key:string, content:string) => void, getLastChange:(key:string) => object|null, dismiss:(key:string) => void}} The tracker.
 */
export function createChangeTracker({ now = () => Date.now() } = {}) {
  const snapshots = new Map(); // key -> { content, hash }
  const lastChanges = new Map(); // key -> change record

  return {
    /** Record observed content. First sighting is a baseline (no change).
     * Returns the new change record if the content differs from the last
     * known snapshot, else null. */
    observe(key, content) {
      const prev = snapshots.get(key);
      const hash = hashOf(content);
      if (!prev) { snapshots.set(key, { content, hash }); return null; }
      if (prev.hash === hash) return null;
      const change = { key, before: prev.content, after: content, beforeHash: prev.hash, afterHash: hash, at: now() };
      snapshots.set(key, { content, hash });
      lastChanges.set(key, change);
      return change;
    },
    /** Accept content as the new baseline without recording a change (the
     * editor's own saves). Clears the file's pending external-change notice. */
    adopt(key, content) {
      snapshots.set(key, { content, hash: hashOf(content) });
      lastChanges.delete(key);
    },
    /** The most recent unacknowledged external change for a file, or null. */
    getLastChange(key) { return lastChanges.get(key) || null; },
    /** Drop the pending notice for a file (baseline stays). */
    dismiss(key) { lastChanges.delete(key); },
  };
}

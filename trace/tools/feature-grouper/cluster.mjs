// Deterministic agglomerative clustering (average linkage, cosine similarity, merge while the best pair's
// similarity is >= threshold). Ties break on the lowest cluster indices, so the same input always gives the
// same clusters.
import { cosine } from "./embed.mjs";

/**
 * Cluster unit vectors.
 *
 * @param {number[][]} vectors L2-normalised vectors.
 * @param {number} threshold Merge while the best average cosine similarity is at least this.
 * @returns {{members: number[], similarity: number}[]} Clusters ordered by their smallest member index; `members`
 *   are ascending indices into `vectors`; `similarity` is the mean pairwise cosine within (1 for a singleton).
 */
export function cluster(vectors, threshold) {
  const n = vectors.length;
  let clusters = vectors.map((_, i) => ({ members: [i] }));
  const sim = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? -Infinity : cosine(vectors[i], vectors[j]))));
  const alive = new Array(n).fill(true);
  for (;;) {
    let bi = -1;
    let bj = -1;
    let best = -Infinity;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (alive[j] && sim[i][j] > best + 1e-12) {
          best = sim[i][j];
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0 || best < threshold) break;
    const a = clusters[bi].members.length;
    const b = clusters[bj].members.length;
    for (let k = 0; k < n; k++) {
      if (!alive[k] || k === bi || k === bj) continue;
      const merged = (a * sim[bi][k] + b * sim[bj][k]) / (a + b);
      sim[bi][k] = merged;
      sim[k][bi] = merged;
    }
    clusters[bi] = { members: [...clusters[bi].members, ...clusters[bj].members].sort((x, y) => x - y) };
    alive[bj] = false;
  }
  clusters = clusters.filter((_, i) => alive[i]);
  return clusters
    .map((c) => {
      let total = 0;
      let pairs = 0;
      for (let i = 0; i < c.members.length; i++) {
        for (let j = i + 1; j < c.members.length; j++) {
          total += cosine(vectors[c.members[i]], vectors[c.members[j]]);
          pairs++;
        }
      }
      return { members: c.members, similarity: pairs ? total / pairs : 1 };
    })
    .sort((x, y) => x.members[0] - y.members[0]);
}

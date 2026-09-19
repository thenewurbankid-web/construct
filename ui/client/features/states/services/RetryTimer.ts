/** Runs `done` after a short pretend-work delay; returns a cancel function. Real
 * retries call the failed request again; this stands in for it on the reference page. */
export function scheduleRetry(done: () => void, ms = 400): () => void {
  const id = setTimeout(done, ms);
  return () => clearTimeout(id);
}

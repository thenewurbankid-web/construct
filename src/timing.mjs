// Cheap wall-clock timing helpers shared by every generation/scaffolding
// command's console output (#164/#165/#166/#167) -- process.hrtime.bigint()
// deltas, no new dependency. These never throw and never touch anything the
// command is doing; a caller times a step by bracketing it with
// startTimer()/elapsedSeconds(start), then formats the result itself (via
// formatDuration) into whatever console.log line it already prints -- this
// module only measures and formats, it never decides what/whether to print.
/**
 * Start a wall-clock timer.
 *
 * @returns {bigint} An opaque start value for `elapsedSeconds`.
 *
 * @example
 * const t = startTimer();
 * doWork();
 * formatDuration(elapsedSeconds(t)); // => "0.02s"
 */
export function startTimer() {
  return process.hrtime.bigint();
}

/**
 * Elapsed seconds since `start` (a startTimer() value), as a plain number
 * -- kept unformatted so a caller can still sum/compare several steps (e.g.
 * a running total across a vertical slice or an import plan) before
 * formatting the final number once.
 *
 * @param {bigint} start A value from `startTimer()`.
 * @returns {number} Seconds elapsed since `start`, unformatted.
 */
export function elapsedSeconds(start) {
  return Number(process.hrtime.bigint() - start) / 1e9;
}

/**
 * Render a seconds value the way every timing line in this codebase shows
 * it: two decimal places, an "s" suffix (e.g. "0.02s", "8.34s") -- matches
 * how a human reads "how long did this take" without implying more
 * precision than wall-clock timing actually has.
 *
 * @param {number} seconds Duration in seconds.
 * @returns {string} Seconds with two decimals and an `s` suffix.
 *
 * @example
 * formatDuration(8.3412); // => '8.34s'
 */
export function formatDuration(seconds) {
  return `${seconds.toFixed(2)}s`;
}

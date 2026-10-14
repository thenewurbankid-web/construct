// Hand-written: the one syntax entry that only exists outside strict mode. A module is always strict, so the
// `with` statement lives in this CommonJS script.

/** with (sloppy mode) */
exports.syntax_with_sloppy_mode = function () {
  const point = { x: 3, y: 4 };
  with (point) {
    return x * x + y * y;
  }
};

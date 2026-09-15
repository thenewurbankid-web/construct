export function isAlphaValid(id) {
  return typeof id === 'string' && id.startsWith('alpha-');
}

export function isBetaValid(id) {
  return typeof id === 'string' && id.startsWith('beta-');
}

export function createRegistry(tools) {
  return new Map(tools.map((t) => [t.name, t]));
}

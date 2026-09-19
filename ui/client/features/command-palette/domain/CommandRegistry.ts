// Pure (DOMAIN-001): the command registry. Immutable helpers; registering an
// id again replaces that command in place (keeps its position).
import type { Command } from '../types.ts';

export function addCommands(commands: Command[], added: Command[]): Command[] {
  let next = commands;
  for (const cmd of added) {
    const at = next.findIndex((c) => c.id === cmd.id);
    if (at === -1) next = [...next, cmd];
    else {
      next = next.slice();
      next[at] = cmd;
    }
  }
  return next;
}

export function removeCommands(commands: Command[], ids: string[]): Command[] {
  const drop = new Set(ids);
  return commands.some((c) => drop.has(c.id)) ? commands.filter((c) => !drop.has(c.id)) : commands;
}

// Pure (DOMAIN-001): grouping commands under headings for display.
import type { Command, CommandGroup } from '../types.ts';

/** Groups by heading in order of first appearance, keeping each group's command order. */
export function groupCommands(commands: Command[]): CommandGroup[] {
  const groups: CommandGroup[] = [];
  for (const cmd of commands) {
    const found = groups.find((g) => g.group === cmd.group);
    if (found) found.commands.push(cmd);
    else groups.push({ group: cmd.group, commands: [cmd] });
  }
  return groups;
}

/** Commands in the order they are displayed (group by group). Arrow keys move through this list. */
export function flatten(groups: CommandGroup[]): Command[] {
  return groups.flatMap((g) => g.commands);
}

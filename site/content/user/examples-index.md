Every example has the same shape: the problem, the exact command or screen, exactly what came back, and what you can rely on.

The examples are split by how you reach the same building blocks, and a page never mixes two of them:

- **CLI**: commands in a terminal, with the real output, exit codes and timing. This is what scripts and CI use.
- **Cockpit**: the browser UI, with real screenshots from the project's own Playwright runs.
- **Core**: the plain JavaScript functions underneath, JSON in and JSON out. The CLI and the Cockpit both call them.

Terminal output is pasted from a real run and trimmed only where a page says so. Every page ends with the commit it was checked against.

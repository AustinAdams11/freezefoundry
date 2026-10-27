---
name: Node CLI tool
description: Conventions for small Node.js command-line tools.
triggers: [cli, command line, command-line, script, tool]
roles: [planner, builder]
enabled: true
---

- Single file, Node built-ins only (fs, path, process, readline, util.parseArgs).
- Parse arguments with util.parseArgs; print usage with --help; exit with code 1 and a clear message on bad input.
- Read and write files relative to process.cwd(); never touch paths outside it unless the user passes them.
- Add a "bin" entry and a "test" script in package.json when creating one; put a small node:test file next to it.

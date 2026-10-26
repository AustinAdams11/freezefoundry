# FREEZE FOUNDRY — BUILD SPECIFICATION

## Mission
Build a real local-first AI software factory, not a mock dashboard.
The UI is a pixel-art industrial factory with conveyors, workstations,
animated status lights, machinery, and a dark purple/orange/teal palette.
No anime aesthetic. Use crisp pixel-art geometry and CSS/canvas effects.

## Existing environment
- Windows
- Node.js available
- LM Studio OpenAI-compatible API: http://127.0.0.1:1234/v1
- Model: qwen/qwen3.5-9b
- Factory root: D:\FreezeFoundry\factory
- Current web server: http://127.0.0.1:4177
- Use Node built-ins and vanilla HTML/CSS/JS first. Avoid unnecessary installs.

## Four workers
1. PLANNER — turns a goal into ordered tasks and dependencies.
2. BUILDER — reads project files and proposes/creates code changes.
3. TESTER — runs permitted checks and reports actual results.
4. REVIEWER — inspects diffs, security issues, and acceptance criteria.

These must be actual model-backed workers with distinct roles, prompts,
outputs, and visible execution status—not hardcoded fake activity.

## Workflow
User submits a software goal.
Planner produces structured tasks and acceptance criteria.
Coordinator dispatches tasks in dependency order.
Builder reads relevant files and creates proposed file changes.
Tester runs available, approved project checks.
Reviewer examines the changes and test results.
Failed checks can return work to Builder with the failure details.
Show each step, its output, timestamps, and errors in a persistent activity log.

## File operations
Workers need read/write access inside the factory directory.
Normalize paths and reject traversal outside the configured root.
Ignore symlinks that resolve outside the root.
Keep backups and show diffs before applying generated changes.
Never overwrite the running server or UI without a reviewable proposal.
Provide explicit approval controls for applying changes.
Keep credentials, personal files, and unrelated system directories out of scope.

## Tools
Start with real local file read/write, directory listing, and project inspection.
Support project-local npm scripts for test/build only after checking package.json.
Show the exact command before execution and record exit code and output.
Do not pretend a command ran if it did not.
Do not claim a test passed without its actual result.
Web research can be added through a separately configured provider; never invent
a search result or pretend the model has internet access if it does not.

## Interface
- Factory floor as the home screen.
- Four visually distinct worker stations linked by conveyor paths.
- Conveyors animate when tasks move between workers.
- Each station displays idle/running/success/blocked/error.
- Task submission, workflow timeline, live logs, file browser, diff review,
  approval/rejection, and model connection status.
- Provide a compact operational view as well as the immersive factory view.
- Responsive layout, keyboard-accessible controls, no external UI libraries.

## Engineering priorities
1. Make the current app remain recoverable.
2. Build the actual worker coordinator and task state.
3. Implement reliable model responses and structured outputs.
4. Add scoped project file tools and staged edits.
5. Add review, test execution, and explicit approval.
6. Build the pixel-art factory UI around real worker state.
7. Add persistence and workflow recovery after restart.

## Acceptance criteria
- Submit a task and see real Planner -> Builder -> Tester -> Reviewer work.
- At least one worker can inspect existing project files.
- Builder can propose complete file changes.
- A diff is visible before changes are applied.
- A failed test is reported honestly and can be sent back to Builder.
- Restarting the server does not silently erase task history.
- The UI never fabricates worker activity or test results.
- The running application remains recoverable if a generated change fails.

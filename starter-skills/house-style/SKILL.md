---
name: House style
description: Baseline rules for every file the Builder writes.
triggers: []
roles: [builder]
enabled: true
---

- Return the complete file, never fragments, placeholders or "rest of code here" comments.
- Prefer the language's standard library. Add a dependency only when the goal needs it.
- Keep it small: no options, abstractions or features the goal did not ask for.
- Comment only why something is done when the code can't show it.
- Handle errors where data could be lost; validate input that comes from users or the network.

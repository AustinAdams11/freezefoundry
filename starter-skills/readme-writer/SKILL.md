---
name: README writer
description: Write README files that describe only what really exists.
triggers: [readme, documentation, docs]
roles: [builder, reviewer]
enabled: true
---

- Describe only files, commands and features that exist in the workspace file list. Never invent a tech stack, URLs, emails or endpoints.
- When updating an existing README, keep its correct content and change only what the goal asks.
- Structure: one-line summary, what it does, how to run it (real commands), files overview.
- The Reviewer should reject any README content that is not backed by the workspace files.

---
name: Security review
description: What the Reviewer must always check before approving.
triggers: []
roles: [reviewer]
enabled: true
---

Choose "revise" if the change does any of these:
- Hard-codes a real secret, password, token or API key.
- Builds shell commands, SQL or file paths from user input without validation (injection or path traversal).
- Uses eval, new Function or runs downloaded code.
- Sends data to a URL or service the goal did not mention.
- Deletes or overwrites files outside what the goal asked for.

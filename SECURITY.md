# Security

## Reporting a vulnerability

Please report security problems privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue for anything exploitable. You'll get a reply within a few days, and a fix ships as a new release with a note in the changelog.

## What Freeze Foundry protects against

Freeze Foundry runs a small web server on your own machine and lets AI models propose code. These are the rules it enforces:

| Threat | Protection |
|---|---|
| A website you visit trying to drive the app | The server listens on `127.0.0.1` only, rejects state-changing requests from other origins, and rejects any request whose `Host` header isn't `127.0.0.1`/`localhost` (blocks DNS rebinding). |
| Being embedded in another page (clickjacking) | `X-Frame-Options: DENY` and `frame-ancestors 'none'` on every response. |
| Model output escaping the workspace | Every write is resolved inside the workspace; `..`, absolute paths and symlink escapes are refused. Changes are staged, tested in a throwaway copy and applied only after approval. |
| Model-written commands | The Tester runs fixed commands only (`node --check`, `py_compile`, and the `npm test` script from your **approved** `package.json`). Python scripts run only when you click Run, and only with the permission on. |
| Untrusted text in the interface | Model names, errors and goals are escaped before they reach HTML. The Electron window has no Node.js access (`contextIsolation`, `sandbox`), never navigates away from the app, and refuses camera, microphone, location and similar permissions. |
| API key leaks | Keys are encrypted with the OS keychain (Electron `safeStorage`), stored with owner-only file permissions otherwise, and never sent back to the interface. |
| Unexpected network access | Internet access for workers and Python scripts are off by default. Model downloads accept Hugging Face `.gguf` links only. |
| Corrupted state | Tasks, settings, keys and sources are written atomically. Every applied change keeps a backup and can be undone. |

## What it doesn't protect against

- **Code you approve.** Read diffs before applying, especially for goals that use web pages or reference files you didn't write: they can carry prompt injection aimed at the Builder.
- **Your own workspace tests.** `npm test` runs whatever your approved `package.json` says, like it would in a terminal.
- **Cloud providers.** With a cloud model, the prompts and files a worker needs go to that provider.
- **Unsigned builds.** Installers aren't code-signed yet. Download them only from this repository's Releases page.

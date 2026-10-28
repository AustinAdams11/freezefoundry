# Changelog

Everything that changed in Freeze Foundry, newest first.

## 0.11.0 · 2026-10-28

- **Foreman.** Whole projects from one goal: the Foreman splits it into up to 8 one-file work orders in build order, you edit the plan, and every Builder sees the whole project so the files fit together. The queue tags each order with its project, and you get a summary when the last one finishes.
- **LAN Foundry.** Run workers on other computers in your home. Scan your network for LM Studio and Ollama servers or add one by address, then pick it under Runs on in Worker tuning. Plan on your Mac, build on your gaming PC.
- **Fixed: crash-safe saves and the server log** were listed in 0.10.0 but never actually shipped. They're in now: tasks, settings, keys and sources are written atomically, and `data/logs/server.log` records every error.
- **Sponsor** the project from the Guide or GitHub; the README opens with a demo of a real run.
- CI uses the Node 24 versions of its GitHub Actions.

## 0.10.1 · 2026-10-28

- **Security pass.** The local server now rejects requests whose `Host` isn't localhost (stops DNS-rebinding attacks from websites) and sends anti-framing and no-sniff headers. Model names, server errors and goals are escaped before they reach the screen. The app window can no longer navigate to outside pages and refuses camera, microphone and location permissions. An unused file route without path checks was removed.
- **SECURITY.md** explains what Freeze Foundry protects against and how to report a vulnerability privately.

## 0.10.0 · 2026-10-28

- **Undo.** Every applied change can be rolled back from the Report: the old file comes back, or a newly created file is removed. Undo refuses if you edited the file since, so it never loses your work.
- **Retry.** Failed or staged work orders have a Retry button in the Report that puts the goal back on the ticket.
- **Stop.** A Stop button (or Esc twice) ends the work order on the floor and moves on to the next one.
- **Nothing lost on restart.** Work orders that were waiting or mid-run when the app closed come back paused; press Send with an empty ticket to resume, or Clear to drop them.
- **Sturdier model calls.** A time limit per answer (Settings), automatic retries on rate limits, server errors and dropped connections, and errors that say what to do ("Start LM Studio's server...") instead of "fetch failed".
- **Git commits.** Optionally commit each applied change when the workspace is a git repository, with the goal as the message.
- **Watch webhooks.** An alert can POST to a URL: cut a smart plug's power when a miner overheats, or ping Home Assistant, Discord or ntfy. Watch history and alerts now survive restarts.
- **Crash-safe saves.** Tasks, settings, keys and sources are written atomically, so a crash mid-save can't corrupt them.
- **Logs.** The server keeps a rotating log in `data/logs/server.log`; Settings has an Open logs folder button.
- **Small things.** Copy a file's path or add it to the work order from the Detail panel; the console stops jumping to the bottom while you read older lines; Esc closes dialogs.

## 0.9.0 · 2026-10-27

- **Light and dark themes.** A sun/moon switch in the top bar flips between Frost (light) and Forge (dark); Settings > Appearance can also follow your system.
- **The Guide is now a manual.** Every page of the app is explained in one place: writing work orders, approvals, worker tuning, Watch, the training bay, Apify and troubleshooting. The setup wizard still runs from the Guide.
- **What's new.** This changelog lives in the app. A dot on the Guide button tells you when an update brought something new.

## 0.8.0 · 2026-10-27

- **Worker tuning.** Give the Planner, Builder and Reviewer each their own provider, model, temperature, top-p, token limit and standing instructions, with Precise, Balanced and Creative presets. Plan with Claude and build on your own GPU in the same run.
- **Watch.** Poll miners, servers and APIs on a timer. Presets for Antminer / cgminer (TCP port 4028), Bitaxe / AxeOS, Ollama and CoinGecko prices. Chart a value, alert when a rule trips or a device stops answering, and optionally have your model explain the alert.
- **Training bay.** A PyTorch blueprint and skill, a Run button on approved `.py` files, live output and a loss chart. Off until you allow "Run Python scripts" in Permissions.
- **Python checks.** The Tester syntax-checks `.py` files.
- **AMD-aware training scripts.** Device order is CUDA (NVIDIA, or AMD with ROCm), Apple MPS, DirectML, then CPU.
- **Fixed installer names,** so download links always point at the newest release.
- New starter skills now reach existing installs without bringing back ones you deleted.

## 0.7.1 · 2026-10-27

- **One release per version.** Windows and Mac installers now land in the same GitHub release, published only after both builds finish.
- **Fairer Reviewer.** It judges the file in front of it instead of asking for files other tasks will build.
- The Apify Actor blueprint now creates the output schema the Apify Store requires.

## 0.7.0 · 2026-10-26

- **Cloud models.** Claude, OpenAI, Gemini, OpenRouter and any OpenAI-compatible server, alongside LM Studio and Ollama. API keys are encrypted with your operating system's keychain.
- **Skills, Sources and Permissions.** Reusable instructions in the Agent Skills format, reference files and web pages for the workers, and switches for what the AI may access.
- **Ship to Apify.** Build an Apify Actor from a blueprint and publish it to your account.
- **The frozen foundry.** A new zoomed-out factory floor with a serpentine conveyor, paced animation and the snowflake-and-anvil logo.
- **Overnight queue with Auto-apply.** Work that passes tests and review applies itself; the rest waits in Staged changes and the run report.

## 0.3.0 · 2026-10-26

- **Desktop app** for Windows and macOS, with a first-run setup guide that finds LM Studio or Ollama.
- **Models page.** Download `.gguf` models from Hugging Face into LM Studio, or pull Ollama models, from inside the app.
- **Settings** for folders, generation, attempts and appearance.

## Before 0.3

- The first working line: Planner, Builder, Tester and Reviewer, with a retry loop, diffs, backups and an approval gate in front of every write.

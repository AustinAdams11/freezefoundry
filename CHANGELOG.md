# Changelog

Everything that changed in Freeze Foundry, newest first.

## 0.15.0 · 2026-11-02

- **Make any show.** Press + New show in the Town, say what it is about and how it should be written, pick a look (Tour, Night, Cold case or Countdown) and a length, and the crew makes it like a built-in one. Copy and edit starts from any built-in show. Your shows can be edited or deleted (not while an episode still uses them).
- **Bring your own script.** The new From my script tab records exactly what you wrote: blank lines split it into scenes, the first paragraph is the hook and the last is the ending. The Dispatcher still writes the title and tags, and it waits for your OK like any other script.
- **Facts from real sources.** Ranked and Mysteries now research before writing: the Wikipedia article on the topic, plus your enabled Sources and any links you paste into the idea. The Miner writes only from those notes, the Inspector checks against them, and the video description lists the sources. Needs internet access in Settings > Permissions.
- **Captions that land on the word.** Each word now pops in the instant it is spoken, instead of a whole caption appearing at once, so captions never look ahead of the voice.
- **Record all.** One button records every script that is waiting, one after another. Stop after the current one at any time.
- **Town crew skills.** Tick Town crew on a skill and the Town's writers follow it too, so your house rules reach the videos.
- **Cleaner Town.** The valley's title and tools float on frosted glass, Town settings fold away, episodes without a video take less room, and every button gives a small press when you click it. Respects Reduce motion and Reduce transparency.

## 0.14.0 · 2026-11-01

- **A narrator.** Every Town episode can be read aloud by Kokoro, a natural-sounding text-to-speech model that runs on your own computer (no account, no cloud, free for commercial use). Pick a narrator per show and press Hear it to try it. The voice model downloads once (about 90 MB), then works offline. Scenes last as long as their lines, the music ducks under the voice, and a limiter keeps it from clipping.
- **Live captions.** Big Shorts-style captions, two or three words at a time, with the spoken word lit up. Kokoro times them itself: the narrator runs the timestamped Kokoro build, which reports how long it says every sound, so each word lights up exactly when it is spoken.
- **Three new shows.** Frostpeak Tour walks the camera around the Frostpeak valley to whichever worker the narrator is talking about and explains the real science behind it. Spooky Story tells an original creepy (never gory) story with a twist. Mysteries & Legends tells real unsolved cases, keeping what is documented apart from what people believe. Each show has its own music bed, look and fact-check rules.
- **Your idea, your script.** Type exactly what you want an episode to be about, or leave it empty and the Prospector picks. The script then waits for you: edit any spoken line, the titles and the description, or send it back to the Miner with a note, before anything is recorded. Turn this off in Town settings for fully automatic episodes.
- **Thumbnails.** Every recording comes with a 1080×1920 thumbnail (big two-tone words, the show's look), with the words kept in the middle so YouTube's crops never cut them. Save it, or the video, straight from the episode.
- **Record again** after a failed or rejected take, or after changing the voice.
- **Faster to the point.** Every script opens on its most surprising line (no greetings or warm-ups), scripts are shorter, the narrator reads at 1.1x, and the silence Kokoro leaves around each sentence is trimmed to a short breath.
- **Stories with a payoff.** Spooky stories and mysteries are written beat by beat (setup with a planted detail, escalation where every scene adds something new, a twist or the open question), run 190 to 260 words, and are graded by the Inspector as a story editor. Anything too short goes back to the Miner automatically.
- **Tougher fact checks for Ranked.** Filler items that don't belong in a real top 5, and lists that mix measures (running and diving speeds), are now sent back.
- **Fixed:** Crew notes now open inside the episode card; Copy works in the desktop app; deleting the last episode clears the list; a crew member's broken JSON gets one retry instead of failing the episode.

## 0.13.0 · 2026-10-31

- **Town: Frostpeak Mining Co.** A second crew that makes Shorts on your models, working six mines and a foundry in a snowy pixel valley: the Prospector picks a topic, the Miner writes it, the Inspector checks every number and sends drafts back, the Dispatcher writes the title and tags, the Smelter records the video in the foundry, and the Surveyor tracks views. The Vault adds it all up. Each mine has its own sign and color, and the key under the scene lights up whichever one you hover.
- **Ranked, the first show.** A five-item countdown with a spotlight reveal, counting numbers, a building leaderboard and a question to end on. Recorded at 1080×1920 with original chiptune music, inside the app, as MP4.
- **Your OK before anything goes out.** Episodes wait for you to watch and approve. Paste the link after posting and the Observatory follows its views; the Bank adds up views and an earnings estimate.
- **Autopilot.** A new episode every few hours while the app is open, never more than you have time to review.
- **New logo.** The Hex Ingot: an ice snowflake set into a molten hexagon.

## 0.12.0 · 2026-10-28

- **The Foreman runs whole projects.** It used to plan and queue; now it runs the project to the end on its own, even if you switch pages.
- **Parallel lines.** Each work order lists the files it needs and starts as soon as they're built. Orders that don't depend on each other build at the same time: one on the main line, others on LAN Foundry machines, each with its own model.
- **The Foreman reacts to failure.** When an order fails every attempt, nothing else starts. The Foreman re-plans the remaining work around the problem (twice at most), or pauses so you can Retry, Skip or Stop. A model server that stops answering always pauses.
- **Final inspection.** With every file built, the Tester checks them together, including imports and page links that point at missing files, and the Reviewer reads the whole project. Files with problems go back to their Builder with the notes.
- **One approval, one undo.** Nothing touches the workspace until the project is done. Apply writes every file with backups (and one git commit if that's on); Undo restores them all. Auto-apply ships a project that passes inspection.
- **Project board.** The left drawer shows every file's progress and line, the floor lights up the stations a project is using, and a project that was running when the app closed comes back paused.

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

# roast-commits

A CLI that roasts your git commits. Two modes:

- **history**: analyzes your recent commits locally, then sends the stats to an LLM for a roast
- **live**: a watcher (foreground or background) that roasts every new commit as you make it

Zero dependencies. Needs Node 18+ and git.

## Install

```bash
cd roast-commits
npm link          # makes the `roast` command available globally
```

## Set up an API key

Bring your own key. Supported providers: `anthropic`, `openai`, `gemini`.

```bash
roast config set-key anthropic     # prompts for the key (hidden input)
roast config set provider anthropic
roast config show                  # keys are masked
```

Keys can also come from `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (env vars win over the config file).
With several keys set, the preferred provider is tried first and the others are fallbacks. With no working key, roasts fall back to local heuristics.

Config lives in `~/.config/roast-commits/config.json` (permissions 600). Override the folder with `ROAST_HOME`.

## History mode

```bash
roast history                          # last 20 commits
roast history -n 50 --author me
roast history --since "1 week ago" -i savage
roast history --no-ai                  # local heuristics only, no API call
```

| Option | Meaning |
| --- | --- |
| `-n, --count` | number of commits (default 20) |
| `-a, --author` | author name/email, or `me` |
| `-s, --since` / `--until` | date range, e.g. `"2 days ago"` |
| `-i, --intensity` | `mild`, `medium`, `savage` |
| `-p, --provider` / `-m, --model` | pick a provider or model for this run |
| `-r, --repo` | repo path (default: current directory) |
| `--no-ai` | skip the LLM |

## Live mode

```bash
roast live                # foreground, Ctrl+C to quit
roast live start          # background process, desktop notifications + log file
roast live status
roast live logs -f        # follow the log
roast live stop
```

Only real commits trigger a roast (checkouts, pulls, resets and rebases are ignored). Each repo gets its own background watcher. Use `--no-notify` to disable notifications.

## Platform support

| Platform | Status | Desktop notifications |
| --- | --- | --- |
| Linux | tested | `notify-send` (install `libnotify` if missing) |
| macOS | untested | built in, via `osascript` |
| Windows 10/11 | untested | built in, via PowerShell toast |

Everything else uses only Node 18+ built-ins and git, so it is not platform specific. Notifications are optional: the roasts always go to `roast live logs`, and `--no-notify` turns the popups off.

Config location: `~/.config/roast-commits` (Linux/macOS), `%APPDATA%\roast-commits` (Windows). Override it with `ROAST_HOME`.

## What gets analyzed locally

Lazy messages (`fix`, `wip`, `asdf`), tiny messages, ALL CAPS, `!!!`, profanity, panic words (`oops`, `typo`, `again`), "final" commits, late-night (0 to 5am) and weekend commits, giant diffs (especially with tiny messages), duplicate messages, rapid-fire commits, and lazy-message streaks. These produce a shame score out of 10, and the stats plus flagged commits are sent to the LLM.

## Example output

Real runs. The LLM text is different every time.

**History mode with an LLM**

```
$ roast history

🔥 roast-commits · history mode

commits analyzed 8    shame score ██████░░░░ 6/10
weekend: 5 · giant diff: 3 · giant diff, tiny message: 2
worst offender b246e96 "Update full file" (weekend, giant diff, tiny message)

  Ah, the classic weekend warrior. Five commits on a Saturday or Sunday, because
  who needs work-life balance when you have a git repo? And the best part? Three
  of those are "giant" commits. You're not committing code, you're performing a
  full organ transplant.

  Let's talk about b246e96, "Update full file." Just "Update full file." With
  1382 additions and 922 deletions. You might as well have said "Touched
  everything, broke some stuff, maybe fixed other stuff, good luck."

  Then we have c1ad9ec, "Final website updated." "Final." Always "final." It's
  like calling a toddler "sleep-trained." "Final" is just a suggestion,
  apparently.

  Verdict: This looks less like a git history and more like a series of
  controlled explosions.

  — gemini · gemini-2.5-flash
```

**Local fallback (`--no-ai`, or when the API call fails)**

If the AI request fails (no key, rate limit, overloaded model), you get a warning and a roast from the local heuristics, so the command never just errors out.

```
$ roast history -n 20 -i savage

🔥 roast-commits · history mode

commits analyzed 8    shame score ██████░░░░ 6/10
weekend: 5 · giant diff: 3 · giant diff, tiny message: 2
worst offender b246e96 "Update full file" (weekend, giant diff, tiny message)

! AI request failed: gemini: HTTP 503: This model is currently experiencing high demand. ...

  b246e96: 1 files, 2304 lines changed, and the message is "Update full file".
  Incredible restraint in documentation.
  cb19122: 1 files, 904 lines changed, and the message is "Create index.html".
  Incredible restraint in documentation.
  c1ad9ec: "Final website updated" touches 1 files. That's not a commit, that's
  a migration.
  5041ad8: 1 files and 4185 changed lines in one commit. Reviewers fear you.
  5 weekend commits. Your calendar called, it wants a day off.
  Verdict: this history needs an intervention and probably a style guide.

  — local heuristics (AI unavailable)
```

**Live mode (background watcher)**

```
$ roast live start
Started background watcher (pid 9740) for /home/hp/Data/projects/roast-commits
log: /home/hp/.config/roast-commits/live/091a1a34ce.log
$ git commit --allow-empty -m "fix again"
$ roast live logs
[2:55:28 PM] watching /home/hp/Data/projects/roast-commits
[2:55:30 PM] 8d7ba3e "fix again"
  "fix again," 8d7ba3e, with 0 files changed is a masterpiece of unhelpful. Two
  "fix" commits in a row, within a minute, for nothing. Clearly a sign of
  unparalleled confidence in the previous "fix."
  — gemini · gemini-2.5-flash
```

The roast lands in the log about 2 seconds after the commit, and you also get a desktop notification (Linux needs `notify-send`). Commits made while the watcher is stopped are not roasted later; use `roast history` for those.

**Not in a git repo**

```
$ roast history -n 5 -i savage
✖ Not inside a git repository (use --repo <path>).
```

## Troubleshooting

- **`HTTP 404 ... model is no longer available`**: the provider retired that model. Pick a current one with `roast config set model <provider> <model-id>`. The default for Gemini is `gemini-2.5-flash`.
- **`HTTP 503` / `429`**: the provider is overloaded or rate limiting you. Requests are retried twice automatically, then it falls back to the local roast. Run it again a bit later.
- **`Not inside a git repository`**: `cd` into a repo or pass `--repo <path>`. A folder that merely contains repos does not count.

## Development

There is no build step. The code is plain ESM JavaScript, and `npm link` symlinks this folder, so edits apply the next time you run `roast`.

The one exception is the background watcher. It keeps the old code in memory, so restart it after changes:

```bash
roast live stop && roast live start
```

Project layout:

```
bin/roast.js      entry point
src/cli.js        argument parsing and commands
src/git.js        reads commits and stats from git
src/analyze.js    local heuristics and shame score
src/roast.js      prompt building
src/llm.js        anthropic / openai / gemini adapters with fallback
src/local.js      offline roast templates
src/live.js       watcher, background process, notifications
src/config.js     keys and settings
src/print.js      terminal output
```

If you move or rename the project folder, run `npm link` again.

## Uninstall

```bash
# 1. stop background watchers (run inside each repo you started one in)
roast live stop

# 2. remove the global command
npm unlink -g roast-commits

# 3. remove saved keys, settings and logs
rm -rf ~/.config/roast-commits
```

On Windows the settings folder is `%APPDATA%\roast-commits`; delete it with `rmdir /s /q "%APPDATA%\roast-commits"`.

If a watcher is left running after step 2 (for example you forgot a repo), on Linux/macOS kill it with the command below. On Windows, end the `node.exe` process in Task Manager, or run `roast live stop` from that repo while the package is still installed.

```bash
pkill -f "roast.js live --daemon"
```

Then delete the project folder if you no longer want the source.

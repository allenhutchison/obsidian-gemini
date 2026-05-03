---
name: obsidian-cli
description: >-
  Use the Obsidian CLI to debug, inspect, and test Obsidian plugins during
  development. Covers plugin reloading, console inspection, runtime evaluation,
  driving the UI (commands, CDP, screenshots, mobile emulation), frontmatter
  properties, and common debugging recipes for the gemini-scribe plugin.
metadata:
  author: obsidian-gemini
  version: '1.1'
compatibility: Requires Obsidian desktop with CLI enabled.
---

# Obsidian CLI

The Obsidian CLI (`obsidian` command) provides direct access to a running Obsidian instance from the terminal. It's invaluable for plugin development — you can reload plugins, inspect state, evaluate expressions, drive the UI (open modals, click, type, screenshot), toggle mobile emulation, and view console output without leaving your editor.

The CLI surface is large (100+ commands) and growing. Run `obsidian --help` periodically to spot new capabilities, and `obsidian <command> --help` for per-command flags. This skill documents the parts most useful for plugin work.

## When to use this skill

- Debugging runtime errors during plugin development
- Verifying plugin state after code changes
- Testing migration logic or settings changes
- Inspecting secrets, settings, and vault state
- Reloading the plugin after a rebuild
- Viewing console errors without opening DevTools
- Driving UI surfaces (open modals, click buttons, type into inputs) for automated testing
- Taking screenshots for regression checks or PR descriptions
- Testing mobile-only code paths from a desktop session

## Quick reference

### Plugin development essentials

```bash
# Reload the plugin after rebuilding (use after `npm run build` or `npm run dev`)
obsidian plugin:reload id=gemini-scribe

# Enable DevTools debugger (programmatic CDP attach — does NOT open the DevTools window)
obsidian dev:debug on

# Open the Electron DevTools window itself (toggle — see footgun note below)
obsidian devtools

# View recent console output (errors, warnings, logs)
obsidian dev:console
obsidian dev:console level=error
obsidian dev:console level=warn
obsidian dev:console limit=100

# View captured errors
obsidian dev:errors

# Clear console buffer
obsidian dev:console clear
```

### Evaluating expressions

Use `eval` to run JavaScript against the live Obsidian instance. The expression has access to the full `app` object.

```bash
# Basic eval
obsidian eval code="app.vault.getName()"

# Check plugin is loaded
obsidian eval code="app.plugins.plugins['gemini-scribe'] !== undefined"

# Read plugin settings
obsidian eval code="JSON.stringify(app.plugins.plugins['gemini-scribe'].settings, null, 2)"

# Check the plugin's API key (via SecretStorage getter)
obsidian eval code="app.plugins.plugins['gemini-scribe'].apiKey"
```

### Driving the UI (commands, CDP, screenshots)

The `command` and `dev:cdp` commands turn the CLI into a remote control. Combined with `dev:screenshot`, this is how you exercise UI surfaces from a script (or an agent).

```bash
# Execute any registered Obsidian command (palette entry) by ID
obsidian command id=gemini-scribe:open-scheduler
obsidian command id=command-palette:open

# List all available commands (use to verify an ID exists before depending on it)
obsidian commands
obsidian commands filter=gemini-scribe

# Take a screenshot of the current Obsidian window
obsidian dev:screenshot path=debug-screenshot.png

# Inspect the DOM
obsidian dev:dom selector=".gemini-agent-view"
obsidian dev:dom selector=".gemini-agent-input" text
obsidian dev:dom selector=".gemini-agent-view" css=display
obsidian dev:dom selector=".scheduler-row" total

# Drive the UI via Chrome DevTools Protocol (clicks, key events, raw evals)
obsidian dev:cdp method=Input.dispatchMouseEvent params='{"type":"mousePressed","x":100,"y":200,"button":"left","clickCount":1}'
obsidian dev:cdp method=Input.dispatchMouseEvent params='{"type":"mouseReleased","x":100,"y":200,"button":"left","clickCount":1}'
obsidian dev:cdp method=Input.insertText params='{"text":"Hello"}'
```

`dev:cdp` is escape-hatch level — if `command` + `eval` + `dev:dom` get you what you need, prefer those for readability. Reach for CDP when you need precise mouse coordinates (e.g. clicking inside a canvas) or keyboard events the DOM API doesn't expose well.

### Mobile emulation

Toggles desktop into mobile-emulated mode so platform-gated code paths (`Platform.isMobile`, mobile-only CSS, mobile UI affordances) become testable.

```bash
obsidian dev:mobile on    # Enable mobile emulation. The app reloads automatically.
obsidian dev:mobile off   # Disable. The app reloads automatically.
```

**Footgun**: invoking `obsidian dev:mobile` with **no argument toggles** the current state — that's how you accidentally enable it. Always pass `on` or `off` explicitly. Always toggle off when you're done — the flag persists across CLI invocations and silently changes the app's behaviour for whoever next opens it.

### Frontmatter properties

Use the `property:*` family for frontmatter reads/writes — it goes through Obsidian's property cache, so it stays in sync with the metadata index. Don't reach for `read` + manual YAML parsing for properties.

```bash
# Read all unique property names known to the vault
obsidian properties

# Read a single property from a file
obsidian property:read name=schedule path="gemini-scribe/Scheduled-Tasks/daily-summary.md"

# Set a property (creates it if it doesn't exist)
obsidian property:set name=enabled value=true type=checkbox path="gemini-scribe/Scheduled-Tasks/daily-summary.md"

# Remove a property
obsidian property:remove name=lastRunAt path="gemini-scribe/Scheduled-Tasks/daily-summary.md"
```

`type=` is one of `text|list|number|checkbox|date|datetime`. For frontmatter changes from a plugin, prefer `app.fileManager.processFrontMatter()` (project convention — see `AGENTS.md`); the CLI is for ad-hoc testing.

### Hotkeys

```bash
obsidian hotkey id=gemini-scribe:open-scheduler   # what's bound to this command?
obsidian hotkeys                                  # all hotkeys
obsidian hotkeys all verbose                      # include commands without hotkeys, mark custom vs default
```

### Secret storage

```bash
# List all secrets in the vault
obsidian eval code="app.secretStorage.listSecrets()"

# Read a specific secret value
obsidian eval code="app.secretStorage.getSecret('my-secret-name')"

# Set a secret
obsidian eval code="app.secretStorage.setSecret('my-secret-name', 'my-secret-value')"
```

### Vault and file operations

```bash
# Vault info
obsidian vault

# List vaults (desktop only)
obsidian vaults

# List files
obsidian files
obsidian files folder=gemini-scribe
obsidian files ext=md total

# Read a file
obsidian read path="gemini-scribe/Agent-Sessions/session.md"

# CRUD (useful for setting up test fixtures)
obsidian create name=test-task path="gemini-scribe/Scheduled-Tasks/test-task.md" content="..."
obsidian append path="some-file.md" content="more text"
obsidian prepend path="some-file.md" content="prefix"
obsidian rename path="old.md" name=new.md
obsidian move path="some-file.md" folder=archive
obsidian delete path="some-file.md"

# Open a file in the editor
obsidian open path="gemini-scribe/Agent-Sessions/session.md" newtab

# Search vault contents
obsidian search query="apiKey"
obsidian search:context query="apiKey" limit=5

# Check file info
obsidian file path="data.json"

# Tab management
obsidian tabs
obsidian tab:open path="..."
```

### Plugin management

```bash
# List all plugins
obsidian plugins
obsidian plugins filter=community versions

# Get plugin info
obsidian plugin id=gemini-scribe

# Enable/disable
obsidian plugin:enable id=gemini-scribe
obsidian plugin:disable id=gemini-scribe

# Reload after code changes
obsidian plugin:reload id=gemini-scribe

# Install/uninstall community plugins (for testing compatibility)
obsidian plugin:install id=some-plugin enable
obsidian plugin:uninstall id=some-plugin

# Restricted mode (toggle or check)
obsidian plugins:restrict on
obsidian plugins:restrict off
obsidian plugins:restrict          # report current state
```

### App lifecycle

```bash
obsidian reload     # Reload the current vault (preserves Obsidian process)
obsidian restart    # Restart the Obsidian app entirely
```

`plugin:reload id=gemini-scribe` is almost always what you want during development. Reach for `reload` / `restart` only when investigating something that survives a per-plugin reload.

### CSS snippets and themes

Useful when verifying the plugin doesn't break with non-default themes or third-party styling.

```bash
obsidian themes                              # installed themes
obsidian theme:set name="Catppuccin"         # switch theme
obsidian snippets                            # installed snippets
obsidian snippets:enabled                    # only enabled
obsidian snippet:enable name="my-overrides"
obsidian snippet:disable name="my-overrides"
```

## Common recipes

### Test a fresh install

Remove `data.json` to simulate a new install, then reload:

```bash
# Remove plugin settings (simulates fresh install)
obsidian eval code="app.vault.adapter.remove('.obsidian/plugins/gemini-scribe/data.json')"

# Reload the plugin
obsidian plugin:reload id=gemini-scribe

# Verify settings are defaults
obsidian eval code="JSON.stringify(app.plugins.plugins['gemini-scribe'].settings, null, 2)"
```

### Debug a settings migration

```bash
# Check current settings before migration
obsidian eval code="JSON.stringify(app.plugins.plugins['gemini-scribe'].settings, null, 2)"

# Rebuild and reload
npm run build && obsidian plugin:reload id=gemini-scribe

# Check settings after migration
obsidian eval code="JSON.stringify(app.plugins.plugins['gemini-scribe'].settings, null, 2)"

# Check console for migration logs
obsidian dev:console level=log
```

### Verify a documented command exists

Useful before depending on a command ID in a doc, test, or skill:

```bash
obsidian commands filter=gemini-scribe          # quick visual check
obsidian commands filter=gemini-scribe-ope      # narrower
obsidian eval code="!!app.commands.findCommand('gemini-scribe:open-scheduler')"
```

### Open a UI surface and screenshot it

Pattern: trigger → settle → screenshot → inspect → close.

```bash
# Trigger
obsidian command id=gemini-scribe:open-scheduler

# Settle (animations, lazy renders)
sleep 1

# Screenshot
obsidian dev:screenshot path=scheduler-modal.png

# Inspect DOM
obsidian dev:dom selector=".gemini-scheduler-schedule-row" text

# Close
obsidian eval code="document.querySelector('.modal-close-button')?.click()"
```

### Test a mobile-only code path

```bash
obsidian dev:mobile on
sleep 1
obsidian plugin:reload id=gemini-scribe          # so platform-gated code re-runs
sleep 1
obsidian dev:screenshot path=mobile-view.png
# … exercise the mobile path …
obsidian dev:mobile off                          # ALWAYS revert
```

### Click a specific button via the DOM

Most of the time `command` + `eval` is enough. When you need an actual click (e.g. an event handler that requires a real mouse event), grab the element's bounding rect and use CDP:

```bash
obsidian eval code="(() => { const el = document.querySelector('.gemini-scheduler-new-btn'); if (!el) return null; const r = el.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()"
# Then dispatch a mouse press + release at those coords via dev:cdp Input.dispatchMouseEvent
```

For most click-equivalent needs, `eval code="document.querySelector('...').click()"` is simpler and works fine.

### Simulate the catch-up modal

Useful for exercising PR #723's auto-open-on-mobile behavior or any catch-up code path without waiting for real overdue tasks:

```bash
# 1. Snapshot current state file (so you can restore it)
obsidian read path="gemini-scribe/Scheduled-Tasks/scheduled-tasks-state.json" > /tmp/state-backup.json

# 2. Plant an overdue nextRunAt
obsidian eval code="(async () => {
  const path = 'gemini-scribe/Scheduled-Tasks/scheduled-tasks-state.json';
  const cur = JSON.parse(await app.vault.adapter.read(path));
  Object.values(cur)[0].nextRunAt = new Date(Date.now() - 60_000).toISOString();
  await app.vault.adapter.write(path, JSON.stringify(cur, null, 2));
})()"

# 3. Reload the plugin to trigger handleCatchUp()
obsidian plugin:reload id=gemini-scribe

# 4. Restore (after you're done observing)
obsidian eval code="app.vault.adapter.write('gemini-scribe/Scheduled-Tasks/scheduled-tasks-state.json', $(cat /tmp/state-backup.json | jq -Rs .))"
obsidian plugin:reload id=gemini-scribe
```

### Inspect agent session state

```bash
# List session files
obsidian files folder=gemini-scribe/Agent-Sessions

# Check current session context
obsidian eval code="JSON.stringify(app.plugins.plugins['gemini-scribe'].agentView?.currentSession?.context, null, 2)"
```

### Check for errors after a change

```bash
# Full cycle: build, reload, check for errors
npm run build && obsidian plugin:reload id=gemini-scribe && sleep 1 && obsidian dev:errors
```

### Read or modify a frontmatter property

```bash
obsidian property:read name=schedule path="gemini-scribe/Scheduled-Tasks/daily-summary.md"
obsidian property:set name=enabled value=false type=checkbox path="gemini-scribe/Scheduled-Tasks/daily-summary.md"
obsidian property:remove name=outputPath path="gemini-scribe/Scheduled-Tasks/daily-summary.md"
```

### Target a specific vault

**Critical**: empirically (verified May 2026) the `vault=<name>` flag **does not actually route by name**. The CLI always targets the currently focused Obsidian window, regardless of what's passed. `obsidian vaults` lists every registered vault; that list is informational only — you cannot redirect a CLI call to a non-focused vault. This may change in a future Obsidian release — re-verify periodically.

What this means in practice:

- To target a specific vault, **make it the focused Obsidian window first** (click it, or use macOS `Cmd-Tab` / Windows `Alt-Tab`).
- The `vault=<name>` flag is effectively decorative right now. Continue passing it (it documents intent and may start working in a future release), but don't trust it.
- Always preflight with `obsidian eval code="app.vault.getName()"` — no `vault=` flag, just read what's actually focused.

```bash
obsidian vaults                                                  # all registered vaults (open or not)
obsidian eval code="app.vault.getName()"                         # what the CLI will ACTUALLY hit (focused vault)
```

**Canonical preflight guard** for any script or skill that's about to do destructive work:

```bash
EXPECTED="Test Vault"
ACTIVE=$(obsidian eval code="app.vault.getName()" | sed 's/^=> //')
if [ "$ACTIVE" != "$EXPECTED" ]; then
  echo "Aborting: focused vault is \"$ACTIVE\", expected \"$EXPECTED\"." >&2
  echo "Switch your Obsidian focus to \"$EXPECTED\" (Cmd-Tab on macOS) and retry." >&2
  exit 1
fi
```

Multiple Obsidian windows can run simultaneously (one per vault). Open the test vault in its own window and switch to it before running automated checks against it.

## CLI syntax notes

- Arguments use `key=value` format (no dashes)
- Quote values containing spaces: `code="app.vault.getName()"`
- Boolean flags are bare keywords: `obsidian files total`
- File resolution: `file=` resolves by name (like wikilinks), `path=` is exact
- Most commands default to the active file when `file`/`path` is omitted
- Use `\n` for newline and `\t` for tab in content values
- `obsidian <cmd> --help` prints the command's full parameter list — discover this rather than guess

## Footguns

- **`dev:mobile` toggles when called with no argument.** Always pass `on` or `off`. The state persists across CLI invocations and across Obsidian restarts. Toggle off as soon as you're done with the mobile sub-pass.
- **`devtools` toggles when called with no argument.** Same pattern — leaves the DevTools window open or shut depending on prior state. If you need a known state, query first via `obsidian eval code="!!document.querySelector('.is-developer-tools-open')"` or just call it twice.
- **`dev:debug on` ≠ opening DevTools.** It attaches a Chrome DevTools Protocol debugger so commands like `dev:cdp` work. To open the actual DevTools window, use `devtools`.
- **`plugin:reload` returns success even when the plugin's `onload` threw.** Always follow with `obsidian dev:errors` (or `dev:console level=error`) to confirm a clean load.
- **`commands` lists every Obsidian command, not just plugin-owned ones.** Filter with `filter=<prefix>` to narrow.
- **`vaults` is desktop-only.** Returns "only available on desktop" if invoked in a non-desktop context.
- **Some commands are plugin-conditional.** For example, `dev:css` exists only when a particular dev plugin is enabled; the CLI returns "Command 'dev:css' not found. It may require a plugin to be enabled." Don't depend on conditional commands without first checking they're available.
- **`vault=<name>` does not actually route by name.** Empirically the CLI always targets the focused Obsidian window regardless of what `vault=` is set to. The flag does not error on a bogus value, does not error on a real-but-different-vault value — it just silently hits the focused window. To target a specific vault, focus its Obsidian window first. Always preflight with `obsidian eval code="app.vault.getName()"` (no `vault=` flag — read the truth) and assert it matches the expected vault before any destructive command. See "Target a specific vault" for the canonical guard.
- **Modals stack.** If a previous test left a modal open, the next screenshot will be wrong. Either close all modals at the top of each surface (`obsidian eval code="document.querySelectorAll('.modal-close-button').forEach(b => b.click())"`) or assert `document.querySelector('.modal-container')` is null before opening a new one.
- **Screenshot timing.** DOM updates are async. `sleep 1` is the floor; for animations or first-time renders, `sleep 2`. If a screenshot looks blank, retry with a longer settle.
- **`reload` reloads the vault; `restart` restarts the app.** `plugin:reload id=...` is what you almost always want during development. Don't reach for `reload`/`restart` unless investigating something that survives a per-plugin reload.

## Troubleshooting

### CLI not found

The Obsidian CLI requires Obsidian desktop. Ensure it's installed and accessible from your terminal. Check `obsidian version` to verify.

### Eval returns undefined

The expression may not return a value. Wrap in `JSON.stringify()` for objects, or ensure the expression actually produces a result. For async expressions, wrap in an IIFE: `code="(async () => { … return result; })()"`.

### Plugin not found after reload

Check that the plugin ID is correct (`gemini-scribe`, not `obsidian-gemini`) and that the plugin is enabled:

```bash
obsidian plugins:enabled filter=community
```

### Command ID does not exist

Use `obsidian commands filter=<prefix>` to confirm the ID. Plugin commands are namespaced — `gemini-scribe:open-scheduler`, not `open-scheduler`. The plugin must be enabled for its commands to register.

### Screenshot is blank or stale

Settle longer (`sleep 2`+) and confirm the DOM actually has what you expect via `dev:dom selector=...`. If the screenshot still looks wrong, take a baseline first (`dev:screenshot path=before.png`) so you can diff against the expected state.

### Mobile emulation appears stuck on

Run `obsidian dev:mobile off` and then reload. If you don't know whether it was last toggled on or off, `obsidian eval code="document.body.classList.contains('is-mobile')"` will tell you.

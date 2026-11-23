# Testing Guide

This guide covers how to test Gemini Scribe changes on desktop and mobile, what manual checks to perform, and how CI validation works.

## Desktop Testing

> See also: [Obsidian's official Build a Plugin guide](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)

### Prerequisites

- Node.js and npm installed
- A dedicated test vault (separate from your primary vault)
- The plugin repository cloned locally

### Wiring the Plugin into a Test Vault

There are two ways to connect your development build to a test vault. Choose whichever fits your workflow.

#### Option A: `npm run install:test-vault` (recommended for multi-worktree setups)

This script copies the built artifacts (`main.js`, `manifest.json`, `styles.css`) from the current worktree into the test vault's plugin directory:

```bash
npm run install:test-vault
```

By default it looks under `~/Obsidian/Test Vault/.obsidian/plugins/` and finds the destination by reading each `manifest.json` — it installs into whichever folder declares the plugin's `id`, regardless of how that folder is named. (If several folders declare the same `id`, all are updated and the duplicates are reported; on a fresh vault the canonical `<id>` folder is created.) Override the destination entirely with the `TEST_VAULT_PLUGIN_DIR` environment variable to point at an exact plugin directory:

```bash
TEST_VAULT_PLUGIN_DIR=/path/to/vault/.obsidian/plugins/gemini-scribe npm run install:test-vault
```

Pair this with the [pjeby/hot-reload](https://github.com/pjeby/hot-reload) community plugin (touch an empty `.hotreload` file in the plugin directory) and `npm run dev` for a live-reload loop:

```bash
# terminal 1
npm run dev

# terminal 2 (after each rebuild, or wired to a file-watcher)
npm run install:test-vault
```

Use this approach when you work across multiple git worktrees — a symlink would bind the test vault to one worktree's output, whereas this script always pushes the current worktree's build.

#### Option B: Symlink (simpler for single-worktree setups)

Link your development build into your test vault so changes appear immediately (no copy needed on every rebuild):

```bash
# macOS / Linux
ln -s /path/to/obsidian-gemini /path/to/test-vault/.obsidian/plugins/gemini-scribe

# Windows (PowerShell, run as Administrator)
New-Item -ItemType SymbolicLink -Path "C:\path\to\test-vault\.obsidian\plugins\gemini-scribe" -Target "C:\path\to\obsidian-gemini"
```

### Development Workflow

1. Start the dev build in watch mode:

   ```bash
   npm run dev
   ```

   This rebuilds `main.js` automatically whenever you save a source file.

2. In Obsidian, reload the plugin to pick up changes. You can do this by:
   - **Hot Reload plugin** (recommended): Install [pjeby/hot-reload](https://github.com/pjeby/hot-reload) in your test vault. It watches for changes to `main.js` and `styles.css` and automatically reloads the plugin — no manual steps needed.
   - Toggling the plugin off and on in **Settings → Community plugins**
   - Restarting Obsidian
   - Using the Obsidian CLI: `obsidian plugin:reload id=gemini-scribe`

### Enabling Debug mode

Turn on **Debug mode** in the plugin settings (**Settings → Gemini Scribe → Advanced → Diagnostics → Debug mode**). This enables verbose logging through the Logger service, prefixed with `[Gemini Scribe]`.

### Checking Console Output

Open the developer console to inspect logs and errors:

- **macOS**: `Cmd+Option+I`
- **Windows/Linux**: `Ctrl+Shift+I`
- **Obsidian CLI**: `obsidian dev:console level=error`

Filter by `[Gemini Scribe]` to isolate plugin output.

## Hidden Test Environment (Windows + WSL)

On Windows you can run live tests against a real Obsidian without touching your own vaults and without any Obsidian window appearing on your desktop. The scripts in `scripts/test-env/` run the official Linux build of Obsidian inside WSL on a virtual display (Xvfb), with its own profile and a throwaway vault, and you drive it from Windows over the Chrome DevTools Protocol (CDP). This is also the setup for automated or agent-driven UI checks.

Why bother:

- **Never test against a real vault.** The throwaway profile knows only one vault, which is deleted and recreated on every reset. The CDP client refuses to run unless the connected vault carries the throwaway marker file.
- **No visible window.** Obsidian draws to Xvfb inside WSL. The launch script clears WSLg's `DISPLAY`/`WAYLAND_DISPLAY`, so nothing reaches the Windows desktop. No Hyper-V or Windows Sandbox needed, so it works on Windows Home.

Requirements: WSL with an Ubuntu distribution (tested on Ubuntu 26.04 with Obsidian 1.15.1) and Node 22 or newer on Windows (`cdp.mjs` uses the global `fetch` and `WebSocket`).

### One-time install

From the repository root in PowerShell:

```powershell
wsl -d Ubuntu -u root -- bash scripts/test-env/install.sh
```

This installs Xvfb, jq, the Electron runtime libraries and the latest Obsidian `.deb` from [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases). Pass a version to pin one, for example `... install.sh 1.15.1`.

### Reset the vault and launch

Build first, then reset and launch from the repository root. `wsl` starts in the same folder (translated to `/mnt/c/...`), and `reset-vault.sh` installs the build from the current directory:

```powershell
npm run build
```

```powershell
wsl -d Ubuntu -- bash scripts/test-env/reset-vault.sh
```

```powershell
wsl -d Ubuntu -- bash scripts/test-env/launch.sh
```

`reset-vault.sh` deletes and recreates `~/gs-test` inside WSL: a `vault/` with the plugin enabled (debug mode and hooks on), a separate `profile/`, and the marker file `.gs-throwaway-vault`. It takes an optional worktree path. Use a WSL path (`/mnt/c/...`) or forward slashes, because `wsl` strips backslashes from arguments. `launch.sh` starts Xvfb and Obsidian and prints the DevTools targets. Re-run it to restart Obsidian, for example after a rebuild (reset again to copy the new build in). `stop.sh` stops both.

To run a second, independent instance (say, while another one is in use), set different values for the three settings in `scripts/test-env/env.sh`. Share them with WSL through `WSLENV`:

```powershell
$env:GS_TEST_ROOT='/home/<you>/gs-test-2'; $env:GS_TEST_DISPLAY=':98'; $env:CDP_PORT='9223'; $env:WSLENV='GS_TEST_ROOT/u:GS_TEST_DISPLAY/u:CDP_PORT/u'
```

### Drive it over CDP

`scripts/test-env/cdp.mjs` connects to `127.0.0.1:$CDP_PORT` (default `9222`; WSL forwards it to Windows localhost). Code runs inside the Obsidian window, so `app`, `activeDocument` and `require('electron')` are available. A file's body runs inside an async function: it can `await` and should `return` a JSON-serialisable value.

```powershell
node scripts/test-env/cdp.mjs eval scripts/test-env/examples/smoke.js
```

```powershell
node scripts/test-env/cdp.mjs eval -e "return app.plugins.plugins['gemini-scribe'].manifest.version"
```

`examples/smoke.js` accepts the first-open trust prompt, waits for the plugin to load and reports its state. Use it as a template for feature checks: drive commands with `app.commands.executeCommandById(...)`, fill modals through `activeDocument`, emit events on `plugin.agentEventBus`, and return what you observed.

**Screenshots:** `node scripts/test-env/cdp.mjs shot out.png` captures the main window (1600×1000 by default).

**Mobile width:** `examples/mobile-width.js` resizes the real window with `require('electron').remote.getCurrentWindow().setSize(390, 844)` and turns on the mobile layout with `app.emulateMobile(true)`. Take a `shot` afterwards. Undo with `app.emulateMobile(false)` and `setSize(1600, 1000)`.

**Raw protocol calls:** `node scripts/test-env/cdp.mjs cdp <Method> '<json>'`, for example `Runtime.evaluate` or `Emulation.setDeviceMetricsOverride` (see the gotcha below).

**No API key:** the throwaway profile has no API key, so a real agent turn fails at the model call. That is fine for UI, settings, hook and event-bus checks. For a real turn, add a key in the hidden instance's settings (it stays in that profile and is deleted on the next reset). Use a low-quota key.

### Gotchas

- **Trust prompt on first open.** A freshly reset vault opens with "Do you trust the author of this vault?", and community plugins stay off until it is accepted. `examples/smoke.js` clicks **Trust author and enable plugins**. Do the same before anything that needs the plugin.
- **Settings opens in its own window (Obsidian 1.15+).** That window can become `activeDocument`, so a modal opened afterwards (for example from a settings button) may render there instead of the main window. `cdp.mjs` attaches to the main window. Query `activeDocument` rather than `document`, or close Settings first.
- **CDP `Emulation.*` overrides are temporary.** They reset when the DevTools socket closes, and every `cdp.mjs` call opens and closes its own. Resize the real window with `setSize()` instead, as `examples/mobile-width.js` does.
- **`app.emulateMobile()` reloads the window.** An evaluation that calls it directly is cut off with "Inspected target navigated or closed". Schedule it after returning, as the example does. The next `cdp.mjs` call waits for the reload.
- **Don't use the `obsidian` CLI for this on Windows.** It launches the Windows Obsidian with your last-opened real vault, and `vault=` does not route to another vault. Drive the hidden instance only through `cdp.mjs`.

## Mobile Testing

> See also: [Obsidian's official Mobile Development guide](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development)

### Desktop Mobile Emulation

Before testing on a real device, you can simulate mobile behavior directly in desktop Obsidian. Open the developer console and run:

```js
this.app.emulateMobile(true);
```

This enables the mobile layout and sets `this.app.isMobile` to `true`, so platform-guarded code paths execute as they would on a phone. To toggle it back:

```js
this.app.emulateMobile(!this.app.isMobile);
```

This is the fastest way to catch mobile-specific issues without deploying to a device.

### Verifying No Node Built-ins Load at Startup

Because the plugin declares mobile support (`isDesktopOnly: false`), Obsidian raises an "attempted to load NodeJS package" warning (as a Notice toast and a `console.error`) whenever a `require('fs'|'path'|'crypto'|'url'|…)` runs at plugin load. After any change that touches imports of `@allenhutchison/gemini-utils` or other Node-dependent packages, confirm the load path stays clean using the Obsidian CLI:

```bash
npm run build && npm run install:test-vault
obsidian dev:debug on            # REQUIRED — dev:console captures nothing until the debugger is attached
obsidian dev:console clear
obsidian plugin:reload id=gemini-scribe
sleep 3
obsidian dev:console limit=300 | grep -iE "nodejs|attempt.*load"   # expect NO output
```

An empty grep means no built-ins evaluated at load. (Common footgun: forgetting `dev:debug on` makes every check falsely pass — `dev:console` returns "Debugger not attached".) Repeat with `obsidian dev:mobile on` (then `off`) to confirm under mobile emulation. See the **obsidian-cli** skill for the full recipe.

### Getting Builds onto a Device

There is no way to run `npm run dev` directly on mobile. Instead, build on desktop and sync the output files to your mobile device.

**Required files** (all in the plugin root):

- `main.js`
- `manifest.json`
- `styles.css`

#### Option 1: Obsidian Sync (Recommended)

If you use Obsidian Sync, it automatically syncs plugin files across devices. After building on desktop, wait for sync to complete, then reload the plugin on mobile.

#### Option 2: Cloud Storage (iCloud / Google Drive)

If your test vault is stored in iCloud (iOS) or Google Drive (Android), the built files sync automatically once written to disk. Wait for the cloud sync to finish, then reopen the vault on mobile.

#### Option 3: Manual Copy

Copy `main.js`, `manifest.json`, and `styles.css` from your repo into your mobile vault's `.obsidian/plugins/gemini-scribe/` directory using any file transfer method.

### Remote Debugging on Device

Unlike desktop, mobile Obsidian does not have a built-in developer console. However, you can attach remote DevTools for real debugging:

**Android** (see [Chrome Remote Debugging docs](https://developer.chrome.com/docs/devtools/remote-debugging/)):

1. Enable **USB Debugging** in your device's Developer Settings.
2. Connect the device to your computer via USB.
3. Open a Chromium-based browser and navigate to `chrome://inspect/`.
4. Your Obsidian webview should appear — click **Inspect** to open full DevTools.

**iOS** (requires iOS 16.4+ and macOS):

1. Enable **Web Inspector** on your iOS device: **Settings → Safari → Advanced → Web Inspector**.
2. Connect the device to your Mac via USB.
3. In Safari on macOS, go to **Develop → [your device] → [Obsidian webview]**.
4. See [WebKit's Web Inspector docs](https://webkit.org/web-inspector/) for detailed setup.

### Known Limitations

- **No CLI**: The Obsidian CLI is desktop-only.
- **MCP servers**: Desktop-only; MCP-related features will not function on mobile.
- **Node.js / Electron APIs**: Not available on mobile. Code that uses these without platform guards will crash.
- **Regex lookbehind**: Only supported on iOS 16.4+. If using lookbehind assertions, add fallbacks for earlier versions.

### Platform Guards

When writing code that depends on desktop-only APIs, use Obsidian's built-in platform checks:

```typescript
import { Platform } from 'obsidian';

if (Platform.isDesktop) {
	// Desktop-only code (Electron APIs, MCP, etc.)
}

if (Platform.isMobile) {
	// Mobile-specific fallbacks
}

if (Platform.isIosApp) {
	// iOS-specific code
}

if (Platform.isAndroidApp) {
	// Android-specific code
}
```

### Mobile Testing Strategy

Follow this order:

1. Emulate mobile on desktop first (`this.app.emulateMobile(true)`) to catch layout and platform-guard issues quickly.
2. Ensure all automated tests pass (`npm test`).
3. Verify the feature works correctly on desktop.
4. Sync the build to a real device.
5. Test core flows manually: chat, completions, summarization, agent mode.
6. If issues arise, attach remote DevTools (see above) for real debugging.
7. Watch for crashes, blank screens, or missing UI elements.

## Smoke Test Checklist

Use the appropriate checklist based on what your change affects. All changes should pass the **General** checks.

### General

- [ ] `npm run format-check` passes
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] `npm run typecheck:test` passes (if test files were changed — CI runs this separately)
- [ ] Plugin loads without console errors
- [ ] Plugin unloads and reloads cleanly

### Settings Changes

- [ ] New/changed controls render in the settings tab
- [ ] Values persist after toggling and reloading the plugin
- [ ] Default values are correct for new installs
- [ ] Settings migration works for existing users (if applicable)

### Agent Tools

- [ ] Start a new agent session
- [ ] Invoke the tool via natural language
- [ ] Verify the tool output is correct
- [ ] Test error handling (invalid inputs, missing files, permission denials)
- [ ] Check that tool loop detection does not trigger on normal use

### UI Changes

- [ ] Check both light and dark themes
- [ ] Resize panels and verify responsive behavior
- [ ] Test with different font sizes
- [ ] Verify no CSS overflow or clipping issues
- [ ] Test on mobile if the change affects the agent view or modals

### API Layer

- [ ] Test with a valid API key
- [ ] Test with an invalid/missing API key — verify the error message is clear
- [ ] Verify retry behavior for transient failures (if applicable)
- [ ] Check that model selection changes take effect

## CI Checks

The project enforces quality gates through git hooks and CI:

| Check          | Command                  | When it runs                                          |
| -------------- | ------------------------ | ----------------------------------------------------- |
| Formatting     | `npm run format-check`   | CI only (pre-commit auto-fixes staged files instead)  |
| Build          | `npm run build`          | Pre-push hook                                         |
| Tests          | `npm test`               | Pre-push hook                                         |
| Lint           | `npm run lint`           | CI only (pre-commit auto-fixes staged `*.ts` instead) |
| Test typecheck | `npm run typecheck:test` | CI only                                               |

The pre-commit hook runs `nano-staged`, which auto-fixes formatting (`prettier --write`) and lint issues (`eslint --fix`) on staged files only — a different (and narrower) check than the full-repo, fix-nothing commands CI runs. Run all five full-repo commands locally before pushing to avoid a CI-only failure:

```bash
npm run format-check && npm run build && npm test && npm run lint && npm run typecheck:test
```

> **Watch out for `typecheck:test`**: `npm run build` uses `tsc -skipLibCheck` and excludes `test/`, so a green build does **not** guarantee this check passes. Expression-bodied arrows like `(t) => arr.push(t)` return `number` rather than `void` and are caught only here.

### Integration Test Scripts

For changes to the agent or tool system, run the relevant integration test scripts:

```bash
node test-scripts/test-sdk-tools.mjs
```

See `test-scripts/` for other available integration runners. These validate agent toolchains end-to-end and should be run after touching agent or tool code.

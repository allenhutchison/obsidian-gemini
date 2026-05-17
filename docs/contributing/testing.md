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

### Enabling Debug Mode

Turn on **Debug mode** in the plugin settings (**Settings → Gemini Scribe → Debug mode**). This enables verbose logging through the Logger service, prefixed with `[Gemini Scribe]`.

### Checking Console Output

Open the developer console to inspect logs and errors:

- **macOS**: `Cmd+Option+I`
- **Windows/Linux**: `Ctrl+Shift+I`
- **Obsidian CLI**: `obsidian dev:console level=error`

Filter by `[Gemini Scribe]` to isolate plugin output.

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

| Check      | Command                | When it runs    |
| ---------- | ---------------------- | --------------- |
| Formatting | `npm run format-check` | Pre-commit hook |
| Build      | `npm run build`        | Pre-push hook   |
| Tests      | `npm test`             | Pre-push hook   |

All three must pass before a PR will be reviewed. Run them locally before pushing:

```bash
npm run format-check && npm run build && npm test
```

### Integration Test Scripts

For changes to the agent or tool system, run the relevant integration test scripts:

```bash
node test-scripts/test-sdk-tools.mjs
```

See `test-scripts/` for other available integration runners. These validate agent toolchains end-to-end and should be run after touching agent or tool code.

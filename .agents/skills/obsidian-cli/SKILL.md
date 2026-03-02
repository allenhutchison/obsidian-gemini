---
name: obsidian-cli
description: >-
  Use the Obsidian CLI to debug, inspect, and test Obsidian plugins during
  development. Covers plugin reloading, console inspection, runtime evaluation,
  and common debugging recipes for the gemini-scribe plugin.
metadata:
  author: obsidian-gemini
  version: '1.0'
compatibility: Requires Obsidian desktop with CLI enabled.
---

# Obsidian CLI

The Obsidian CLI (`obsidian` command) provides direct access to a running Obsidian instance from the terminal. It is invaluable for plugin development — you can reload plugins, inspect state, evaluate expressions, and view console output without leaving your editor.

## When to use this skill

- Debugging runtime errors during plugin development
- Verifying plugin state after code changes
- Testing migration logic or settings changes
- Inspecting secrets, settings, and vault state
- Reloading the plugin after a rebuild
- Viewing console errors without opening DevTools

## Quick reference

### Plugin development essentials

```bash
# Reload the plugin after rebuilding (use after `npm run build` or `npm run dev`)
obsidian plugin:reload id=gemini-scribe

# Enable DevTools debugger
obsidian dev:debug on

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

# List files
obsidian files
obsidian files folder=gemini-scribe
obsidian files ext=md total

# Read a file
obsidian read path="gemini-scribe/Agent-Sessions/session.md"

# Search vault contents
obsidian search query="apiKey"
obsidian search:context query="apiKey" limit=5

# Check file info
obsidian file path="data.json"
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

### Inspect DOM for UI debugging

```bash
# Query DOM elements
obsidian dev:dom selector=".gemini-agent-view"
obsidian dev:dom selector=".gemini-agent-input" text

# Check CSS values
obsidian dev:dom selector=".gemini-agent-view" css=display

# Take a screenshot
obsidian dev:screenshot path=debug-screenshot.png
```

### Target a specific vault

If you have multiple vaults open, target a specific one:

```bash
obsidian plugin:reload id=gemini-scribe vault="My Vault"
obsidian eval code="app.vault.getName()" vault="Test Vault"
```

## CLI syntax notes

- Arguments use `key=value` format (no dashes)
- Quote values containing spaces: `code="app.vault.getName()"`
- Boolean flags are bare keywords: `obsidian files total`
- File resolution: `file=` resolves by name (like wikilinks), `path=` is exact
- Most commands default to the active file when `file`/`path` is omitted
- Use `\n` for newline and `\t` for tab in content values

## Troubleshooting

### CLI not found

The Obsidian CLI requires Obsidian desktop. Ensure it's installed and accessible from your terminal. Check `obsidian version` to verify.

### Eval returns undefined

The expression may not return a value. Wrap in `JSON.stringify()` for objects, or ensure the expression actually produces a result.

### Plugin not found after reload

Check that the plugin ID is correct (`gemini-scribe`, not `obsidian-gemini`) and that the plugin is enabled:

```bash
obsidian plugins:enabled filter=community
```

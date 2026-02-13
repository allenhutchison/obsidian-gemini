# Obsidian CLI Reference

The Obsidian CLI (available in Obsidian 1.12+) allows controlling Obsidian from the terminal for scripting, automation, and integration with external tools.

## Requirements

- Obsidian 1.12 or above (early access)
- Catalyst license required
- Enable via Settings > General > Command line interface
- Obsidian application must be running (first command launches the app if needed)

## Platform setup

### macOS

CLI registration modifies `~/.zprofile` to add the Obsidian binary directory to PATH. Alternative shells (Bash, Fish) require manual PATH configuration. Restart terminal after registration.

### Linux

Creates symlink at `/usr/local/bin/obsidian`. AppImage installations may require manual symlink creation. Snap users may need to set `XDG_CONFIG_HOME`.

### Windows

Requires downloading the `Obsidian.com` terminal redirector and placing it in the Obsidian installation directory.

## Usage modes

### Single command mode

```bash
obsidian <command> [params] [flags]
```

### Interactive TUI mode

```bash
obsidian
```

Enter `obsidian` without arguments for an interactive terminal with autocomplete (Tab), command history (arrow keys), and reverse search (Ctrl+R).

### Vault targeting

```bash
obsidian vault=<name> <command>
obsidian vault="My Vault" <command>
```

## Parameter syntax

- Parameters: `param=value` or `param="value with spaces"`
- Flags: boolean switches included without values (e.g., `silent`, `overwrite`, `all`, `verbose`)
- Multi-line content: Use `\n` for newlines, `\t` for tabs
- File targeting: `file=<name>` (wikilink-style resolution) or `path=<path>` (exact vault path)
- Copy output: Append `--copy` to copy results to clipboard

## Command reference

### General

| Command   | Description                |
| --------- | -------------------------- |
| `help`    | Display available commands |
| `version` | Show Obsidian version      |
| `reload`  | Reload app window          |
| `restart` | Restart application        |

### File operations

| Command                                                                      | Description                               |
| ---------------------------------------------------------------------------- | ----------------------------------------- |
| `create name=<name> [content=<text>] [template=<name>] [overwrite] [silent]` | Create a file, optionally from a template |
| `read [file=<name> \| path=<path>]`                                          | Display file contents                     |
| `append [file=<name> \| path=<path>] content=<text>`                         | Append content to a file                  |
| `prepend [file=<name> \| path=<path>] content=<text>`                        | Prepend content to a file                 |
| `move [file=<name> \| path=<path>] to=<path>`                                | Rename or relocate a file                 |
| `delete [file=<name> \| path=<path>] [permanent]`                            | Delete a file                             |
| `file [file=<name> \| path=<path>]`                                          | Show file info                            |
| `files [total]`                                                              | List vault files                          |
| `folder [path=<path>]`                                                       | Show folder info                          |
| `folders [total]`                                                            | List vault folders                        |

### Daily notes

| Command                        | Description              |
| ------------------------------ | ------------------------ |
| `daily`                        | Open today's daily note  |
| `daily:read`                   | View daily note contents |
| `daily:append content=<text>`  | Append to daily note     |
| `daily:prepend content=<text>` | Prepend to daily note    |

### Search and navigation

| Command                                         | Description                                 |
| ----------------------------------------------- | ------------------------------------------- |
| `search query=<text> [format=<fmt>]`            | Search vault with formatting options        |
| `search:open query=<text>`                      | Launch search interface in the app          |
| `random [folder=<path>]`                        | Open a random note                          |
| `outline [file=<name>] [format=tree\|markdown]` | Display headings in tree or markdown format |

### Links and references

| Command                   | Description                        |
| ------------------------- | ---------------------------------- |
| `backlinks [file=<name>]` | Show incoming links to a file      |
| `links [file=<name>]`     | Display outgoing links from a file |
| `unresolved`              | List broken/unresolved links       |
| `orphans`                 | Find notes with no incoming links  |
| `deadends`                | Find notes with no outgoing links  |

### Properties and metadata

| Command                                              | Description                             |
| ---------------------------------------------------- | --------------------------------------- |
| `aliases [file=<name>]`                              | List file aliases                       |
| `properties [file=<name>] [sort=<field>]`            | View file properties                    |
| `property:set [file=<name>] key=<key> value=<value>` | Set a property                          |
| `property:remove [file=<name>] key=<key>`            | Remove a property                       |
| `property:read [file=<name>] key=<key>`              | Read a property value                   |
| `tags`                                               | Display all tags with occurrence counts |
| `tag tag=<name>`                                     | Get specific tag information            |

### Tasks

| Command                                          | Description               |
| ------------------------------------------------ | ------------------------- |
| `tasks [file=<name>] [status=<char>] [daily]`    | List tasks with filtering |
| `task ref=<file:line> [toggle \| status=<char>]` | Show or update a task     |

### Plugin and theme management

| Command                    | Description                                    |
| -------------------------- | ---------------------------------------------- |
| `plugins`                  | List all installed plugins                     |
| `plugins:enabled`          | List enabled plugins                           |
| `plugin:install id=<id>`   | Install a community plugin                     |
| `plugin:uninstall id=<id>` | Uninstall a plugin                             |
| `plugin:enable id=<id>`    | Enable a plugin                                |
| `plugin:disable id=<id>`   | Disable a plugin                               |
| `plugin:reload`            | Reload all plugins (useful during development) |
| `themes`                   | List installed themes                          |
| `theme:set name=<name>`    | Activate a theme                               |
| `snippets`                 | Manage CSS snippets                            |

### Sync and file history

| Command                                  | Description                       |
| ---------------------------------------- | --------------------------------- |
| `sync [pause \| resume]`                 | Pause or resume synchronization   |
| `sync:status`                            | Check sync status and usage       |
| `sync:history [file=<name>]`             | List sync file versions           |
| `sync:read [file=<name>] version=<n>`    | Read a specific sync version      |
| `sync:restore [file=<name>] version=<n>` | Restore a sync version            |
| `diff [file=<name>] from=<n> to=<n>`     | Compare file versions             |
| `history [file=<name>]`                  | List local file recovery versions |

### Publishing

| Command                                       | Description                |
| --------------------------------------------- | -------------------------- |
| `publish:site`                                | Show publication info      |
| `publish:list`                                | List published files       |
| `publish:status`                              | Check publish status       |
| `publish:add [file=<name> \| path=<path>]`    | Publish a file             |
| `publish:remove [file=<name> \| path=<path>]` | Unpublish a file           |
| `publish:open [file=<name>]`                  | View published file online |

### Workspace management

| Command                                 | Description                      |
| --------------------------------------- | -------------------------------- |
| `workspace`                             | Display current workspace layout |
| `workspace:save name=<name>`            | Save current workspace           |
| `workspace:load name=<name>`            | Load a workspace                 |
| `workspace:delete name=<name>`          | Delete a saved workspace         |
| `tabs`                                  | List open tabs                   |
| `tab:open [file=<name> \| path=<path>]` | Open a file in a new tab         |

### Developer commands

| Command                      | Description                           |
| ---------------------------- | ------------------------------------- |
| `dev:eval code=<expression>` | Execute JavaScript in the app console |
| `dev:console`                | View captured console messages        |
| `dev:dom query=<selector>`   | Query DOM elements                    |
| `dev:css query=<selector>`   | Inspect CSS with source locations     |
| `dev:screenshot`             | Capture app screenshot                |
| `dev:mobile`                 | Toggle mobile emulation               |
| `dev:cdp`                    | Run Chrome DevTools Protocol commands |
| `dev:errors`                 | Display captured errors               |

### Other commands

| Command                       | Description                          |
| ----------------------------- | ------------------------------------ |
| `bases`                       | Manage Bases                         |
| `bookmarks [add file=<name>]` | Add and list bookmarks               |
| `command name=<name>`         | Execute a registered command by name |
| `commands`                    | List all registered commands         |
| `hotkey command=<name>`       | View hotkey for a command            |
| `hotkeys`                     | List all hotkey bindings             |
| `templates`                   | Access template system               |
| `unique [name=<name>]`        | Create a unique note                 |
| `vault`                       | View current vault info              |
| `vaults`                      | List all vaults                      |
| `web url=<url>`               | Open URL in web viewer               |
| `wordcount [file=<name>]`     | Count words and characters           |

## Common usage examples

```bash
# Create a note from a template
obsidian create name="Trip to Paris" template=Travel

# Append a task to today's daily note
obsidian daily:append content="- [ ] Buy groceries"

# Search and copy results
obsidian search query="meeting notes" --copy

# List all vault files with totals
obsidian files total

# Compare file versions
obsidian diff file=README from=1 to=3

# Toggle a task's completion status
obsidian task ref="Recipe.md:8" toggle

# Execute JavaScript in the running app
obsidian dev:eval code="app.vault.getFiles().length"

# Reload plugins after code changes during development
obsidian plugin:reload

# View DOM structure
obsidian dev:dom query=".workspace-leaf"

# Open a specific vault
obsidian vault="My Notes" daily
```

## TUI keyboard shortcuts

| Shortcut        | Action                             |
| --------------- | ---------------------------------- |
| Tab             | Enter suggestion/autocomplete mode |
| Shift+Tab       | Exit suggestion mode               |
| Up / Ctrl+P     | Previous history entry             |
| Down / Ctrl+N   | Next history entry                 |
| Ctrl+R          | Reverse history search             |
| Ctrl+A / Ctrl+E | Jump to line start/end             |
| Alt+B / Alt+F   | Jump back/forward one word         |
| Ctrl+U          | Delete to line start               |
| Ctrl+K          | Delete to line end                 |
| Ctrl+W          | Delete previous word               |
| Ctrl+L          | Clear screen                       |
| Escape          | Cancel current operation           |
| Ctrl+C / Ctrl+D | Exit TUI                           |

## Troubleshooting

- Ensure you have the latest installer (1.11.7+) and early access version (1.12.x)
- Restart terminal after registering CLI for PATH changes to take effect
- The Obsidian application must be running; the first CLI command will launch it if needed
- On Linux, verify symlinks exist (`ls -la /usr/local/bin/obsidian`)
- On macOS, check shell config files for PATH exports if using non-default shells

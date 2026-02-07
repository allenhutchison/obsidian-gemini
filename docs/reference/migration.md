# Migration Guide: Upgrading to v4.0.0

This guide helps you upgrade to Gemini Scribe v4.0.0, which introduces a unified agent-first experience and automatic history migration.

## What's Changed in v4.0.0

### Major Changes

1. **Unified Chat Interface**
   - The plugin now has a single chat interface with full agent capabilities
   - The previous note-centric chat mode has been removed
   - All conversations now support tool calling and agent features by default

2. **Automatic History Migration**
   - Old chat history files are automatically migrated to the new Agent Sessions format
   - Your original files are backed up to `History-Archive/` for safety
   - Migration happens automatically on first launch after upgrade

3. **Simplified Settings**
   - Removed API provider selection (Gemini-only now)
   - Removed "Enable Agent Mode" toggle (always enabled)
   - Streamlined settings focused on Gemini configuration

4. **New Folder Structure**
   - Chat sessions now stored in `[Plugin State Folder]/Agent-Sessions/`
   - Legacy history files backed up to `[Plugin State Folder]/History-Archive/`
   - Custom prompts remain in `[Plugin State Folder]/Prompts/`

## Automatic Migration Process

When you first launch v4.0.0:

1. **Migration Check**
   - The plugin automatically checks if you have old history files
   - If found, a migration modal appears offering to convert them

2. **Migration Modal Options**
   - **Migrate History:** Converts all old chat files to new Agent Sessions format
   - **Skip Migration:** Continues without converting (you can run migration later)

3. **What Happens During Migration**
   - All files in `History/` folder are backed up to `History-Archive/`
   - New session files are created in `Agent-Sessions/` folder
   - Session titles are generated from your original file names
   - All conversation content is preserved
   - Original files remain in the backup folder

4. **After Migration**
   - Your old history files are safe in `History-Archive/`
   - New sessions appear in the Agent Sessions list
   - You can continue using your vault normally

## Manual Migration Control

If you skip the initial migration or need to migrate additional files later:

### Re-run Migration

1. Open Obsidian Settings
2. Go to "Gemini Scribe" settings
3. Scroll to "Chat History" section
4. Click "Re-run Migration" button
5. Follow the migration modal prompts

### View Backup Files

1. Open Obsidian Settings
2. Go to "Gemini Scribe" settings
3. Scroll to "Chat History" section
4. Click "View Backup" button to open the `History-Archive/` folder

## Breaking Changes

### Removed Features

1. **Note-Centric Chat Mode**
   - **What changed:** The separate note-centric chat view has been removed
   - **Impact:** All chats now use the unified agent interface
   - **Action required:** None - migration handles conversion automatically

2. **API Provider Selection**
   - **What changed:** Removed Ollama and multi-provider support
   - **Impact:** Plugin now exclusively uses Google Gemini
   - **Action required:** Ensure you have a valid Gemini API key

3. **Enable Agent Mode Toggle**
   - **What changed:** Removed the setting to enable/disable agent mode
   - **Impact:** Tool calling is always available
   - **Action required:** None - all features work the same

### Changed Behaviors

1. **Chat History Location**
   - **Old:** `[Plugin State Folder]/History/[Note Name] - Gemini History.md`
   - **New:** `[Plugin State Folder]/Agent-Sessions/[Session Title].md`
   - **Impact:** History files are now session-based instead of note-based
   - **Action required:** None - migration handles conversion

2. **Session Management**
   - **Old:** Each note had its own history file
   - **New:** Sessions can be created, saved, and resumed independently
   - **Impact:** More flexible conversation management
   - **Action required:** Use the session controls in the chat interface

3. **Settings Structure**
   - **Old:** Separate chat and agent model settings
   - **New:** Unified model settings apply to all chat interactions
   - **Impact:** Simplified configuration
   - **Action required:** Review your model selections in settings

## Troubleshooting Migration Issues

### Migration Modal Doesn't Appear

If you have old history files but don't see the migration modal:

1. Check that "Enable Chat History" is toggled ON in settings
2. Manually trigger migration:
   - Go to Settings → Gemini Scribe → Chat History
   - Click "Re-run Migration"

### Migration Fails or Shows Errors

If migration encounters errors:

1. **Check the migration report** in the modal for specific error messages
2. **Common issues:**
   - Corrupted history files: These will be skipped, others will migrate
   - Permission issues: Ensure Obsidian has write access to your vault
   - Duplicate titles: The plugin automatically handles this by adding numbers

3. **Recovery steps:**
   - Your original files are always preserved in `History-Archive/`
   - You can manually review any failed files
   - Re-running migration will only process unmigrated files

### Can't Find Old Conversations

If you can't find your old conversations after migration:

1. **Check Agent Sessions folder:**
   - Navigate to `[Plugin State Folder]/Agent-Sessions/`
   - Look for sessions with titles matching your old history file names

2. **Check Migration Status:**
   - Go to Settings → Gemini Scribe → Chat History
   - Review the "Migration Status" section

3. **View Backup:**
   - Click "View Backup" in settings
   - Your original files are in `History-Archive/` unchanged

### Session Not Loading Properly

If a migrated session has issues:

1. **Create a new session** and continue your conversation there
2. **Check the session file** in `Agent-Sessions/` for corruption
3. **Reference the backup** in `History-Archive/` if needed

## Reverting to Old Version

If you need to revert to v3.x:

1. **Your data is safe:**
   - Original history files are in `History-Archive/`
   - Settings are preserved

2. **Downgrade steps:**
   - Disable Gemini Scribe plugin
   - Install previous version manually from GitHub releases
   - Re-enable the plugin

3. **After downgrade:**
   - Your old history files are still in `History-Archive/`
   - You may need to manually copy them back to `History/`

## Getting Help

If you encounter issues not covered in this guide:

1. **Check the console** for detailed error messages:
   - Press Ctrl/Cmd + Shift + I to open developer tools
   - Look for errors related to Gemini Scribe

2. **File an issue** on GitHub:
   - Include your error messages
   - Describe what you were doing when the error occurred
   - Mention if this is related to migration

3. **Community support:**
   - Visit the [GitHub Issues](https://github.com/allenhutchison/obsidian-gemini/issues) page
   - Search for similar issues or create a new one

## Post-Migration Best Practices

After migrating to v4.0.0:

1. **Review your sessions** in the Agent Sessions folder
2. **Clean up** old backup files once you're confident migration succeeded
3. **Update bookmarks** or links to reference new session files
4. **Explore new features** like enhanced session management and tool calling
5. **Adjust settings** to take advantage of the streamlined configuration

## FAQ

**Q: Will migration delete my old chat history?**
A: No! All original files are preserved in the `History-Archive/` folder. The plugin never deletes your data.

**Q: Can I run migration multiple times?**
A: Yes. The migration process checks for files that haven't been migrated yet and only processes those.

**Q: What happens if I skip migration?**
A: You can run it later from settings. Your old history files remain untouched until you choose to migrate.

**Q: Do I need to migrate to use v4.0.0?**
A: No, but you won't see your old conversations in the new interface until you migrate them.

**Q: Can I manually edit migrated sessions?**
A: Yes! Session files are markdown files. You can edit them directly, but be careful with the frontmatter metadata.

**Q: Will my custom prompts still work?**
A: Yes! Custom prompts are not affected by this migration and work exactly the same way.

---

**Last Updated:** v4.0.0
**Questions or Issues?** Visit [GitHub Issues](https://github.com/allenhutchison/obsidian-gemini/issues)

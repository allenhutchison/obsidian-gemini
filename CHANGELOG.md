# Changelog

## [3.2.0] - UNRELEASED

### 🎉 New Features

#### Agent Mode
- **AI Agent with Tool Calling**: New agent mode that can actively work with your vault
  - Read, write, and manage files with permission controls
  - Search files and folders with pattern matching
  - Integrated Google Search for web information
  - Web page fetching and analysis
  - Session-based conversation history
  - Context file management with @ mentions
  - Loop detection to prevent infinite tool execution

#### Session Configuration
- **Session-level Settings**: Override global settings per session
  - Custom model selection per conversation
  - Temperature and Top-P controls
  - Custom prompt templates per session
  - Settings persist with session history

#### Custom Prompts
- **Enhanced Prompt System**: Create reusable prompt templates
  - Handlebars template support
  - Access to note content, selection, and metadata
  - Organized in dedicated Prompts folder
  - Quick access via slash commands

### 🔧 Improvements

- **Selection-based Rewriting**: New right-click menu for rewriting selected text
- **Folder Structure**: Organized plugin files into subdirectories (History/, Prompts/, Agent-Sessions/)
- **File Safety**: System folders (.obsidian, plugin folders) are protected from agent operations
- **Error Handling**: Better error messages and recovery for API failures
- **Performance**: Reduced API calls through better caching and session management

### 🐛 Bug Fixes

- Fixed frontmatter persistence when settings changed to defaults
- Fixed "Error Getting Bot Response" in note-centric chat
- Fixed history file naming for better cross-platform compatibility
- Fixed session settings not being saved properly
- Fixed context files being duplicated in sessions

### 💔 Breaking Changes

#### 1. Folder Structure Reorganization
- **Old**: All files in `gemini-scribe/` folder
- **New**: Files organized into subfolders:
  - `gemini-scribe/History/` - Chat history files
  - `gemini-scribe/Prompts/` - Custom prompt templates
  - `gemini-scribe/Agent-Sessions/` - Agent mode sessions
- **Migration**: Automatic on first launch, but verify your files are properly moved

#### 2. History Filename Format
- History filenames have been flattened for better compatibility
- Legacy files are automatically migrated
- External integrations may need to update file path references

#### 3. Full-File Rewrite Removal
- **Removed**: Complete file rewriting feature and UI
- **Replacement**: Use the new selection-based rewriting (right-click on selected text)
- **Impact**: Update your workflows to use selection-based approach

#### 4. Database Export Removal
- **Removed**: All database export/import functionality
- **Impact**: Rely on markdown history files for persistence

#### 5. Custom Prompts Default
- **Changed**: Custom prompts now disabled by default
- **Action Required**: Enable in settings if you use custom prompts

#### 6. New Required Settings
- Several new settings with defaults that may affect behavior:
  - `temperature` (0.7) - Response creativity
  - `topP` (1.0) - Response diversity
  - `stopOnToolError` (true) - Agent stops on tool failures
  - `loopDetectionEnabled` (true) - Prevents infinite loops
- Review and adjust these settings as needed

### 📚 Migration Guide

1. **Before upgrading**:
   - Backup your vault
   - Note any custom prompt usage
   - Document any external integrations

2. **After upgrading**:
   - Verify history files are in `gemini-scribe/History/`
   - Re-enable custom prompts if needed
   - Test agent mode with read-only permissions first
   - Update any scripts that directly access history files

3. **Adapting workflows**:
   - Replace full-file rewrites with selection-based rewrites
   - Use agent mode for complex file operations
   - Configure session-level settings for different use cases

### 🔒 Security Notes

- Agent mode includes permission controls for destructive operations
- System folders are protected from modifications
- Always review agent actions before confirming (unless bypassed)
- Session permissions can be configured per conversation

---

## Previous Versions

See [GitHub Releases](https://github.com/allen-n/obsidian-gemini/releases) for earlier versions.
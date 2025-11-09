# Changelog

## [4.0.0] - 2025-11-09

### 🎉 Major Release: Unified Agent-First Experience

This major release simplifies Gemini Scribe by consolidating around a single, powerful agent-first interface. All chat interactions now have full tool-calling capabilities by default.

### ✨ New Features

- **Unified Chat Interface**: Single chat mode with full agent capabilities - no more switching between modes
- **Automatic History Archival**: Old note-based chat history safely archived
  - V4 welcome modal on first launch
  - Original files preserved in `History-Archive/`
  - Clean migration to agent-first experience
- **AGENTS.md Vault Context**: Initialize vault understanding for the agent
  - "Initialize Vault Context" button in empty agent sessions
  - AI-powered vault analysis and organization understanding
  - Persistent context file that helps agent understand your vault structure
  - Refresh button to update context as vault grows
- **Update Notification System**: Stay informed about new features
  - Version-specific release notes displayed on updates
  - Command palette command to view release notes anytime
  - Smart detection skips notifications on first install
- **Enhanced Documentation**: Complete docs overhaul for v4
  - Agent-first documentation throughout
  - Migration guide from v3.x
  - Updated workflows and examples
  - Improved troubleshooting guides
- **Streamlined SDK Integration**: Now using `@google/genai` official SDK for better reliability

### 🔧 Improvements

- **Simplified Settings**: Removed confusing dual-mode toggles and legacy provider options
- **Better Documentation**: Comprehensive migration guide and updated README
- **Improved Reliability**: Direct SDK integration reduces API compatibility issues
- **Cleaner Architecture**: Removed 600+ lines of legacy code
- **Context File Handling**: Fixed issues with @ mentioned files not being read properly
- **Active File Management**: Better tracking of auto-added vs manually-added context files
- **UI Responsiveness**: AGENTS.md button updates immediately after initialization

### 💔 Breaking Changes

#### 1. Single Chat Interface Only
- **Removed**: Note-centric chat mode and separate GeminiView
- **Impact**: All conversations now use Agent Mode with tool calling
- **Action Required**: None - migration handles conversion automatically
- **Benefit**: Simpler, more powerful interface for all users

#### 2. Gemini-Only Support
- **Removed**: API provider selection and Ollama support
- **Impact**: Plugin now exclusively uses Google Gemini
- **Action Required**: Ensure you have a valid Gemini API key
- **Benefit**: Focused development on the best-supported platform

#### 3. History File Location Change
- **Old**: `[Plugin State Folder]/History/[Note Name] - Gemini History.md`
- **New**: `[Plugin State Folder]/Agent-Sessions/[Session Title].md`
- **Impact**: History files reorganized by session instead of by note
- **Action Required**: Automatic migration preserves all data
- **Benefit**: More flexible session management

#### 4. Agent Mode Always Enabled
- **Removed**: "Enable Agent Mode" toggle in settings
- **Impact**: Tool calling always available
- **Action Required**: None - all features work the same
- **Benefit**: Simpler configuration, more consistent experience

### 🗑️ Removed Features

- Note-centric chat view (`gemini-view.ts` - 625 lines)
- API provider selection dropdown
- "Enable Agent Mode" setting
- Legacy API implementation (`gemini-api.ts`, `ollama-api.ts`, `api-factory.ts`)
- Dual-ribbon icon system

### 📚 Documentation

- **New**: [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) - Comprehensive upgrade guide
- **Updated**: README.md with v4.0.0 information
- **Updated**: Advanced settings guide

### 🔄 Migration Notes

**First Launch After Upgrade:**
1. Plugin checks for old history files
2. Migration modal appears if files found
3. Choose to migrate now or later
4. All original files backed up safely

**Migration Safety:**
- Original files always preserved in `History-Archive/`
- Migration can be re-run multiple times safely
- Detailed error reporting if any files fail
- Manual migration controls in settings

See [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) for detailed migration instructions and troubleshooting.

### 🧪 Testing

- All 367 tests pass (24 test suites)
- New tests for update notifications, AGENTS.md, and context handling
- Comprehensive integration test coverage
- Manual QA performed on desktop platforms

---

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
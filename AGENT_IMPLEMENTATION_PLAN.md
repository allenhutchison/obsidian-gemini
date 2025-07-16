# Agent Architecture Implementation Plan

## Current Status (✅ Completed)

### Phase 1: Foundation Architecture
- **Agent Types & Interfaces** (`src/types/agent.ts`)
  - AgentContext, ChatSession, ToolCategory, DestructiveAction interfaces
  - SessionType enum (note-chat vs agent-session)
  - Default context configurations

- **Session Management** (`src/agent/session-manager.ts`)
  - SessionManager class with full lifecycle management
  - Note-chat and agent-session creation/loading
  - Context file management (add/remove files)
  - Session promotion (note → agent)
  - Hybrid history system foundation

- **Chat UI Refactoring** 
  - Integrated SessionManager into main plugin
  - Updated GeminiView to use sessions internally
  - Maintained 100% backward compatibility
  - Added session utility methods

- **Agent Mode UI** (`src/ui/gemini-view.ts`, `src/ui/file-picker-modal.ts`)
  - Agent mode toggle in chat interface
  - Context file management panel with add/remove functionality  
  - Context depth slider (0-5 levels)
  - File picker modal for selecting multiple context files
  - Real-time UI updates and session state synchronization
  - Professional CSS styling for all components

## Phase 2: Agent Session History (✅ Completed)

### 2.1 History System Enhancement
**File:** `src/agent/session-history.ts` ✅
- ✅ SessionHistory class for agent session management
- ✅ Agent-Sessions/ folder structure implementation
- ✅ Session metadata in frontmatter (context files, tools, timestamps)
- ✅ Hybrid history system (History/ for notes, Agent-Sessions/ for agent mode)

**File:** `src/history/history.ts` ✅
- ✅ Added `getHistoryForSession(session: ChatSession)` method
- ✅ Added `addEntryToSession(session: ChatSession, entry)` method
- ✅ Routes to appropriate history handler based on session type
- ✅ Backward compatibility maintained for note-centric chats

### 2.2 Agent Session Persistence
**File:** `src/agent/session-manager.ts` ✅
- ✅ Session persistence with metadata updates
- ✅ Session loading from Agent-Sessions/ folder
- ✅ Auto-save session metadata on context changes
- ✅ Session lifecycle management (create/load/update/delete)

### 2.3 UI Updates for Session History
**File:** `src/ui/gemini-view.ts` ✅
- ✅ Agent session history loading when switching modes
- ✅ Messages save to appropriate session history
- ✅ Session state synchronization with UI
- ✅ Agent mode toggle with full context management

## Phase 2.5: Separate Agent View Architecture (✅ Major Enhancement)

### Separate View Implementation
**File:** `src/ui/agent-view.ts` ✅
- ✅ Complete AgentView class extending ItemView
- ✅ Dedicated agent interface with session header, context panel, tool panel
- ✅ Session management with auto-generated and custom titles
- ✅ Context file management with add/remove functionality
- ✅ Context depth control with real-time UI updates
- ✅ Chat container with proper message display and history loading
- ✅ Input area with keyboard shortcuts and send functionality

### UI Separation and Integration
**File:** `src/main.ts` ✅
- ✅ AgentView registration with VIEW_TYPE_AGENT
- ✅ Ribbon icon for agent mode access
- ✅ activateAgentView method for view management
- ✅ Command registration for agent mode

**File:** `src/ui/gemini-view.ts` ✅
- ✅ Removed all agent mode functionality
- ✅ Reverted to pure note-centric chat approach
- ✅ Clean separation of concerns between views

### Auto-Labeling System
**File:** `src/ui/agent-view.ts` ✅
- ✅ autoLabelSessionIfNeeded method for intelligent session naming
- ✅ AI-generated titles based on conversation content and context files
- ✅ Automatic file renaming with sanitized filenames
- ✅ Session metadata updates and UI refresh
- ✅ Error handling for graceful fallback

## Phase 3: Tool System Foundation (✅ Completed)

### 3.1 Tool Framework
**File:** `src/tools/types.ts` ✅
- ✅ Tool, ToolResult, ToolExecutionContext interfaces
- ✅ ToolParameterSchema for parameter validation
- ✅ ToolCall and ToolExecution types
- ✅ ToolChoice configuration for AI requests

**File:** `src/tools/tool-registry.ts` ✅
- ✅ ToolRegistry class with full lifecycle management
- ✅ Tool registration, validation, and categorization
- ✅ Permission checking and session-based filtering
- ✅ Parameter validation against schemas
- ✅ Tool descriptions for AI context

**File:** `src/tools/execution-engine.ts` ✅
- ✅ ToolExecutionEngine with robust permission checking
- ✅ User confirmation workflows via modal dialogs
- ✅ Tool result formatting and error handling
- ✅ Execution history tracking and audit trail
- ✅ UI feedback integration with real-time updates

### 3.2 Vault Operation Tools
**File:** `src/tools/vault-tools.ts` ✅
- ✅ `read_file(path: string)` - Read file contents with metadata (no confirmation)
- ✅ `write_file(path: string, content: string)` - Create/modify files (with confirmation)
- ✅ `list_files(path: string, recursive?: boolean)` - Browse vault structure (no confirmation)
- ✅ `create_folder(path: string)` - Create directories (with confirmation)
- ✅ `delete_file(path: string)` - Delete files/folders (with confirmation)
- ✅ `move_file(sourcePath: string, targetPath: string)` - Move/rename files (with confirmation)
- ✅ `search_files(pattern: string, limit?: number)` - Search with wildcard support (no confirmation)

### 3.3 Google Search Tool
**File:** `src/tools/google-search-tool.ts` ✅
- ✅ `google_search(query: string)` - Web search via separate model instance
- ✅ Works around Google Search + function calling limitation
- ✅ Returns search results with optional grounding metadata
- ✅ Categorized as READ_ONLY (no confirmation needed)

### 3.4 Permission & UI System
**File:** `src/ui/tool-confirmation-modal.ts` ✅
- ✅ Sophisticated confirmation modal with parameter display
- ✅ Custom confirmation messages and warnings
- ✅ Parameter expansion for long values
- ✅ Professional styling and user experience

**File:** `src/ui/agent-view.ts` ✅
- ✅ Tool execution details integrated into chat messages
- ✅ System messages show tool parameters and results
- ✅ Real-time execution feedback in conversation flow
- ✅ Removed separate tool panel for cleaner UI
- ✅ Tool testing interface removed (no longer needed)

**File:** `src/main.ts` ✅
- ✅ Tool system initialization in plugin startup
- ✅ Tool registry and execution engine setup
- ✅ All vault tools automatically registered
- ✅ Settings integration for tool behavior

## Phase 4: AI Tool Integration (✅ Completed)

### 4.1 AI Model Tool Integration
**File:** `src/api/interfaces/model-api.ts` ✅
- ✅ Extended ModelApi interface with tool support
- ✅ Added availableTools to ExtendedModelRequest
- ✅ Added toolCalls to ModelResponse
- ✅ ToolCall interface for function calling

**File:** `src/tools/tool-converter.ts` ✅
- ✅ Converts internal tools to Gemini function declarations
- ✅ Proper parameter schema mapping
- ✅ Type conversions for Gemini compatibility

**File:** `src/ui/agent-view.ts` ✅
- ✅ Full AI tool integration in handleToolCalls method
- ✅ Automatic tool execution from AI requests
- ✅ Tool chaining support (multiple sequential calls)
- ✅ Tool results fed back to model for response
- ✅ Empty response handling for thinking models

### 4.2 Gemini Function Calling
**File:** `src/api/implementations/gemini-api-new.ts` ✅
- ✅ Complete Gemini function calling implementation
- ✅ functionDeclarations format (camelCase)
- ✅ Google Search + function calling mutual exclusivity handled
- ✅ Tool call parsing from model responses
- ✅ Support for multiple tool calls in single response

### 4.3 Bug Fixes & Improvements
- ✅ Fixed file name sanitization for cross-platform compatibility
- ✅ Fixed tool format to use functionDeclarations (not function_declarations)
- ✅ Fixed Google Search conflict with function calling
- ✅ Fixed tool chaining by including tools in follow-up requests
- ✅ Fixed search_files wildcard pattern support
- ✅ Fixed empty model responses with thinking tokens
- ✅ Improved UI with tool execution in chat messages

## Phase 5: Enhanced Tool Features (✅ Completed)

### 5.1 Additional Tools
**File:** `src/tools/google-search-tool.ts` ✅
- Google Search with grounding metadata
- Citation extraction and formatting
- Works alongside function calling

**File:** `src/tools/web-fetch-tool.ts` ✅
- URL content analysis using Google's URL Context
- HTTP fallback for unreachable pages
- AI-powered content summarization

**File:** `src/tools/deep-research-tool.ts` ✅
- Multi-iteration research capabilities
- Comprehensive citation management
- Iterative query refinement

### 5.2 UI Enhancements
- Folder @ mentions for recursive file inclusion ✅
- Tool display names for friendly UI ✅
- Citation display with inline references ✅
- File chip cursor positioning fixes ✅
- Session-level permissions for tool execution ✅

### 5.3 Tool Safety
- Loop detection for infinite executions ✅
- Tool call ordering (reads before writes) ✅
- Enhanced error handling and fallbacks ✅

## Phase 6: MCP Integration (🔄 Next Priority)

### 6.1 MCP Client Implementation
**File:** `src/mcp/mcp-client.ts` (planned)
- MCP protocol client implementation
- Server discovery and connection management
- Tool schema parsing and validation
- Message routing and response handling

**File:** `src/mcp/mcp-server-manager.ts` (planned)
- Multiple MCP server management
- Server configuration and credentials
- Health monitoring and reconnection
- Server capability enumeration

### 6.2 MCP Tools Integration
**File:** `src/tools/mcp-tools.ts` (planned)
- Bridge MCP server tools into internal tool system
- Parameter conversion and validation
- Error handling and retry logic
- Tool categorization from MCP schemas

### 6.3 MCP Configuration UI
**File:** `src/ui/mcp-settings.ts` (planned)
- MCP server configuration interface
- Add/remove/test server connections
- Tool permission management per server
- Server status monitoring

**Estimated Time:** 3-4 days
**Dependencies:** Tool system ✅, settings infrastructure ✅

## Phase 6: Enhanced Context System (🧠 Intelligence)

### 6.1 Multi-File Context Processing
**File:** `src/files/multi-file-context.ts` (new)
- Extend FileContextTree for agent sessions
- Handle multiple root files efficiently
- Context relevance scoring and prioritization
- Smart context truncation when hitting limits

### 6.2 Context-Aware Tool Execution
**File:** `src/tools/context-integration.ts` (new)
- Pass session context to tools automatically
- Context-based tool suggestions
- Cross-reference tool results with session files
- Maintain context coherence across tool calls

**Estimated Time:** 2-3 days
**Dependencies:** Tool system, session management

## Phase 7: Advanced Agent Features (🚀 Power User)

### 7.1 Multi-Step Workflows
**File:** `src/agent/workflow-engine.ts` (new)
- Chain multiple tool calls together
- Conditional execution based on results
- Workflow templates and reusable patterns
- Progress tracking and resumption

### 7.2 Agent Session Templates
**File:** `src/agent/session-templates.ts` (new)
- Pre-configured agent sessions for common tasks
- Template sharing and import/export
- Dynamic template customization
- Template marketplace integration

### 7.3 Advanced UI Features
**File:** `src/ui/agent-dashboard.ts` (new)
- Full-screen agent workspace interface
- Session timeline and activity view
- Tool execution visualization
- Bulk operations interface

**Estimated Time:** 4-5 days
**Dependencies:** All previous phases

## Implementation Strategy

### Development Order (Recommended)
1. ✅ **Agent Session History** - Complete the core session experience
2. ✅ **Tool Framework** - Build execution infrastructure  
3. ✅ **Vault Tools** - Add immediate value with file operations
4. ✅ **AI Tool Integration** - Connect AI models to tools automatically
5. ✅ **Enhanced Tool Features** - Additional tools and UI improvements
6. 🔄 **Architectural Refactoring** - Unify chat implementations
7. 🔄 **MCP Integration** - Connect external tools
8. 🔄 **Advanced Features** - Power user capabilities

### Key Principles
- **Backward Compatibility** - Never break existing note-centric chats
- **Progressive Enhancement** - Each phase adds value independently
- **User Control** - Always require permission for destructive actions
- **Performance** - Keep UI responsive during tool execution
- **Security** - Validate all tool inputs and outputs

### Testing Strategy
- **Unit Tests** - All tool implementations and core logic
- **Integration Tests** - Tool execution with real vault operations
- **UI Tests** - Agent mode interactions and session management
- **Performance Tests** - Multi-file context processing
- **Security Tests** - Permission system and input validation

### Migration Considerations
- Existing note chats remain unchanged
- Agent sessions start as opt-in feature
- Gradual rollout of tool categories
- Setting migrations for new tool permissions
- User education and onboarding flows

## Branch Strategy

Current work is on `feature/agent-architecture` branch:
- All foundation work committed
- Ready for Phase 2 implementation
- Will merge to master when agent sessions are complete
- Future phases can be separate feature branches

## Documentation Updates Needed

When complete, update:
- **README.md** - Add agent mode features and capabilities
- **User Documentation** - Agent mode guide, tool usage, MCP setup
- **Developer Documentation** - Tool development guide, MCP integration
- **CLAUDE.md** - Architecture updates and development patterns

## Success Metrics

Phase completion criteria:
- ✅ **Phase 1** - Users can switch to agent mode and manage context
- ✅ **Phase 2** - Agent sessions persist and resume properly
- ✅ **Phase 2.5** - Separate AgentView with auto-labeling
- ✅ **Phase 3** - Basic vault tools work with permission system
- ✅ **Phase 4** - AI models can automatically call tools during conversation
- ✅ **Phase 5** - Enhanced tools with citations, web fetch, and research
- 🎯 **Phase 6** - First external MCP tool integrated successfully
- 🎯 **Phase 7** - Enhanced features improve user experience
- 🎯 **Phase 8** - Quality assurance ensures reliability
- 🎯 **Phase 9** - Power users can build complex workflows

---

**Current Status:** Phase 5 Complete ✅ - All core agent features implemented  
**Next Milestone:** Documentation & Architectural Refactoring  
**Target:** MCP Integration and unified architecture

## Recent Progress Summary

### Major Accomplishments
- **Complete Agent Architecture Foundation** - All core types, session management, and UI components
- **Full Agent Session History System** - Persistent sessions with metadata and hybrid history storage
- **Comprehensive Tool System** - Complete framework with vault operations, permissions, and UI feedback
- **Separate AgentView Architecture** - Dedicated view with complete separation from note-centric chat
- **Intelligent Auto-Labeling** - AI-generated session titles with automatic file renaming
- **AI Tool Integration** - Full Gemini function calling with automatic tool execution
- **Security & Permissions** - Robust confirmation system with session-level bypass option
- **Backward Compatibility** - Existing note-centric chats unaffected

### Latest Feature Additions (✅ Completed)
- **Google Search Tool** - Web search with citation support and grounding metadata
- **Web Fetch Tool** - URL content analysis with HTTP fallback for unreachable pages
- **Deep Research Tool** - Comprehensive multi-iteration research with citations
- **Folder @ Mentions** - Include all markdown files from a folder recursively
- **Tool Display Names** - Human-friendly names in UI instead of technical IDs
- **Citation Display** - Inline citations [1], [2] with sources section in responses
- **File Chip Improvements** - Fixed cursor positioning with non-breaking spaces
- **Tool Loop Detection** - Prevents infinite execution loops with configurable thresholds

### Key Implementation Highlights
- **9 Tools** implemented: 7 vault tools + Google Search + Web Fetch + Deep Research
- **Session Permissions** - Bypass confirmations for trusted operations
- **Tool Execution UI** - Collapsible details with status indicators and results
- **Folder Chips** - Visual indicators for folder mentions with file counts
- **Citation System** - Automatic extraction and formatting from search results
- **HTTP Fallback** - Direct fetch when Google URL Context fails
- **Professional CSS** - Comprehensive styling for all new UI elements

### Architecture Decisions
- **Separate View Pattern** - AgentView vs GeminiView for clear separation
- **Manual Context Building** - Session files instead of automatic active file context
- **Hybrid History System** - `History/` for notes, `Agent-Sessions/` for agent mode
- **Tool Category System** - READ_ONLY, VAULT_OPERATIONS, EXTERNAL_MCP, SYSTEM
- **Type-Safe Implementation** - Full TypeScript coverage with comprehensive interfaces
- **Modular Design** - Clear separation of concerns across tool system components
- **Plugin Integration** - Seamless integration with existing Obsidian plugin architecture
- **Extensible Framework** - Easy to add new tools and categories
- **Performance Optimized** - Efficient context management and tool execution

## Phase 5: Architectural Refactoring (🏗️ New Priority)

### 5.1 Unified Chat Architecture
**Goal:** Refactor note-centric mode to be a specialized agent configuration

**File:** `src/agent/agent-configurations.ts` (new)
- Define AgentConfiguration interface
- Create preset configurations (note-centric, full-agent, research, etc.)
- Configuration includes: enabled tools, auto-context, UI options, prompts

**File:** `src/ui/unified-chat-view.ts` (refactor from agent-view.ts)
- Single chat implementation for all modes
- Configuration-driven behavior
- Dynamic UI based on configuration
- Streaming support with tool execution

**Benefits:**
- Single codebase to maintain
- All features available in any mode
- Consistent history and session management
- Easier feature development

### 5.2 Migration Strategy
- Deprecate GeminiView gradually
- Migrate note-centric users transparently
- Preserve all existing functionality
- Add configuration switcher in UI

**Estimated Time:** 3-4 days
**Dependencies:** Current agent architecture

## Phase 6: MCP Integration (🔌 External Tools)

### 6.1 MCP Client Implementation
**File:** `src/mcp/mcp-client.ts`
- MCP protocol client (stdio and HTTP transports)
- Server discovery and connection management
- Tool schema parsing and validation
- Message routing and response handling

**File:** `src/mcp/mcp-server-manager.ts`
- Multiple MCP server management
- Server configuration and credentials
- Health monitoring and reconnection
- Server capability enumeration

### 6.2 MCP Tools Integration
**File:** `src/tools/mcp-tool-adapter.ts`
- Bridge MCP tools to internal tool system
- Dynamic tool registration from MCP schemas
- Parameter conversion and validation
- Error handling and retry logic

### 6.3 MCP Configuration UI
**File:** `src/ui/mcp-settings-tab.ts`
- MCP server configuration interface
- Add/remove/test server connections
- Tool permission management per server
- Server status monitoring

**Estimated Time:** 4-5 days
**Dependencies:** Tool system ✅, unified architecture

## Phase 7: Enhanced Features (🚀 Next Level)

### 7.1 Streaming with Tool Execution
**File:** `src/api/streaming-tools.ts`
- Stream responses that pause for tool execution
- Show partial responses during long operations
- Tool confirmation without breaking stream
- Progress indicators for long-running tools

### 7.2 Tool Result Caching
**File:** `src/tools/tool-cache.ts`
- Cache read_file results until file changes
- Cache web_fetch with configurable TTL
- Cache search results for identical queries
- Smart cache invalidation

### 7.3 Agent Memory System
**File:** `src/agent/memory-system.ts`
- Long-term memory storage (facts, preferences)
- Short-term working memory
- Semantic search over past conversations
- Memory persistence across sessions

### 7.4 Custom Agent Personas
**File:** `src/agent/persona-manager.ts`
- Define custom agent configurations
- Specialized tool sets per persona
- Custom prompts and behaviors
- Save/load persona templates

### 7.5 Parallel Tool Execution
**File:** `src/tools/parallel-executor.ts`
- Detect independent tool calls
- Execute non-conflicting tools concurrently
- Aggregate results efficiently
- Maintain execution order where needed

## Phase 8: Documentation & Testing (📚 Quality)

### 8.1 Comprehensive Documentation
- **User Guide** - Complete agent mode manual
- **Tool Documentation** - Each tool with examples
- **Developer Guide** - Creating custom tools
- **MCP Integration Guide** - Connecting external services
- **Video Tutorials** - Common workflows

### 8.2 Test Infrastructure
**File:** `tests/tools/*.test.ts`
- Unit tests for each tool
- Integration tests for tool execution
- Mock MCP server for testing
- Performance benchmarks

**File:** `tests/agent/*.test.ts`
- Session management tests
- Context handling tests
- UI interaction tests
- Configuration tests

### 8.3 CI/CD Improvements
- Automated testing on PR
- Performance regression detection
- Security scanning for tools
- Documentation generation

## Phase 9: Advanced Capabilities (🧠 Intelligence)

### 9.1 Tool Usage Analytics
**File:** `src/analytics/tool-analytics.ts`
- Track tool usage patterns
- API cost estimation
- Token usage breakdown
- Performance metrics dashboard

### 9.2 Conversation Branching
**File:** `src/agent/conversation-tree.ts`
- Save conversation checkpoints
- Explore alternative paths
- Compare different approaches
- Version control for chats

### 9.3 Tool Marketplace
**File:** `src/marketplace/tool-store.ts`
- Community tool repository
- Tool package format
- Installation/update system
- Ratings and reviews

## Implementation Roadmap

### Immediate Priorities (Next 2 weeks)
1. **Documentation** - Document current features thoroughly
2. **Testing** - Build comprehensive test suite
3. **Architectural Refactoring** - Unify chat implementations
4. **MCP Integration** - Connect to external tools

### Medium Term (Next month)
5. **Streaming Support** - Better UX for long operations
6. **Memory System** - Persistent agent knowledge
7. **Tool Caching** - Performance optimization
8. **Custom Personas** - Specialized agents

### Long Term (Next quarter)
9. **Parallel Execution** - Advanced performance
10. **Analytics** - Usage insights
11. **Branching** - Conversation exploration
12. **Marketplace** - Community ecosystem

## Success Metrics Update

Phase completion criteria:
- ✅ **Phase 1-4** - Foundation, sessions, tools, AI integration
- 🎯 **Phase 5** - Unified architecture improves maintainability
- 🎯 **Phase 6** - MCP enables external tool ecosystem
- 🎯 **Phase 7** - Enhanced features improve user experience
- 🎯 **Phase 8** - Quality assurance ensures reliability
- 🎯 **Phase 9** - Advanced features for power users

---

**Current Status:** Phase 4 Complete ✅ with Enhanced Features  
**Next Milestone:** Documentation & Architectural Refactoring  
**Target:** MCP Integration by end of next sprint

The foundation is now solid for the next generation of agent capabilities!
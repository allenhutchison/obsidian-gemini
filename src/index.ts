/**
 * Obsidian Gemini Scribe - Public API Exports
 * 
 * This file exports all public types, interfaces, and classes
 * that can be used by external plugins or extensions.
 */

// Agent and Session Types
export {
    // Enums
    ToolCategory,
    DestructiveAction,
    SessionType,
    
    // Constants
    DEFAULT_CONTEXTS
} from './types/agent';

export type {
    // Interfaces
    AgentContext,
    SessionModelConfig,
    ChatSession,
    ChatMessage,
    ToolExecution
} from './types/agent';

// Tool System Types
export type {
    Tool,
    ToolResult,
    ToolExecutionContext,
    ToolParameterSchema,
    ToolCall,
    ToolChoice
} from './tools/types';

// Model API Interfaces
export type {
    ModelApi,
    ModelResponse,
    BaseModelRequest,
    ExtendedModelRequest,
    ToolDefinition,
    StreamCallback,
    StreamingModelResponse
} from './api/interfaces/model-api';

// Conversation Types
export type {
    BasicGeminiConversationEntry,
    GeminiConversationEntry
} from './types/conversation';

// Prompt System Types
export type {
    CustomPrompt,
    PromptInfo
} from './prompts/types';

// Model Configuration
export {
    GEMINI_MODELS
} from './models';

export type {
    ModelRole,
    GeminiModel,
    ModelUpdateResult
} from './models';

// Settings Types
export type {
    ObsidianGeminiSettings,
    ModelDiscoverySettings
} from './main';

// Service Types
export type {
    GoogleModel,
    ModelDiscoveryResult
} from './services/model-discovery';

export type {
    ModelUpdateOptions
} from './services/model-manager';

export type {
    ParameterRanges,
    ModelParameterInfo
} from './services/parameter-validation';

// Tool Loop Detection
export type {
    LoopDetectionInfo
} from './tools/loop-detector';

// API Provider
export {
    ApiProvider
} from './api/api-factory';

// Model and Agent Factories
export {
    ModelFactory,
    ModelType
} from './api/model-factory';

export {
    AgentFactory
} from './agent/agent-factory';

export type {
    AgentConfig
} from './agent/agent-factory';

// API Configuration Types
export type {
    ApiConfig,
    ModelConfig,
    RetryConfig,
    ApiFeatures
} from './api/config/model-config';

// Core Classes for Extension
export {
    ToolRegistry
} from './tools/tool-registry';

export {
    ToolExecutionEngine
} from './tools/execution-engine';

export {
    SessionManager
} from './agent/session-manager';

export {
    SessionHistory
} from './agent/session-history';

export {
    PromptManager
} from './prompts/prompt-manager';

export {
    ModelManager
} from './services/model-manager';

export {
    ModelDiscoveryService
} from './services/model-discovery';

// Vault Tools - Useful for creating custom tools
export {
    ReadFileTool,
    WriteFileTool,
    ListFilesTool,
    CreateFolderTool,
    DeleteFileTool,
    MoveFileTool,
    SearchFilesTool,
    getVaultTools
} from './tools/vault-tools';

// Web Tools
export {
    GoogleSearchTool
} from './tools/google-search-tool';

export {
    WebFetchTool
} from './tools/web-fetch-tool';

// Utility function for API creation
export {
    ApiFactory
} from './api/api-factory';

// Config-based API implementations (for advanced usage)
export {
    GeminiApiConfig
} from './api/implementations/gemini-api-config';

export {
    RetryDecoratorConfig
} from './api/retry-decorator-config';

// Main Plugin Class (for type reference)
export { default as ObsidianGeminiPlugin } from './main';

// Re-export commonly used Obsidian types for convenience
export type {
    TFile,
    TFolder,
    TAbstractFile,
    Plugin,
    PluginManifest,
    App,
    Vault,
    MetadataCache,
    Workspace,
    MarkdownView,
    Editor,
    EditorPosition,
    EditorRange
} from 'obsidian';
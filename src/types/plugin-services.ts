import type { ScribeFile } from '../files';
import type { AgentView } from '../ui/agent-view/agent-view';
import type { GeminiHistory } from '../history/history';
import type { SessionHistory } from '../agent/session-history';
import type { PromptManager, GeminiPrompts } from '../prompts';
import type { SessionManager } from '../agent/session-manager';
import type { ToolRegistry } from '../tools/tool-registry';
import type { ToolExecutionEngine } from '../tools/execution-engine';
import type { AgentsMemory } from '../services/agents-memory';
import type { ExamplePromptsManager } from '../services/example-prompts';
import type { VaultAnalyzer } from '../services/vault-analyzer';
import type { DeepResearchService } from '../services/deep-research';
import type { ImageGeneration } from '../services/image-generation';
import type { Logger } from '../utils/logger';
import type { FileLogWriter } from '../utils/file-log-writer';
import type { RagIndexingService } from '../services/rag-indexing';
import type { SelectionActionService } from '../services/selection-action-service';
import type { MCPManager } from '../mcp/mcp-manager';
import type { SkillManager } from '../services/skill-manager';
import type { ContextManager } from '../services/context-manager';
import type { FolderInitializer } from '../services/folder-initializer';
import type { ModelManager } from '../services/model-manager';
import type { GeminiCompletions } from '../completions';
import type { GeminiSummary } from '../summary';
import type { ProjectManager } from '../services/project-manager';
import type { AgentEventBus } from '../agent/agent-event-bus';
import type { ToolExecutionLogger } from '../subscribers/tool-execution-logger';
import type { BackgroundTaskManager } from '../services/background-task-manager';
import type { BackgroundStatusBar } from '../services/background-status-bar';
import type { ScheduledTaskManager } from '../services/scheduled-task-manager';
import type { HookManager } from '../services/hook-manager';

/**
 * Module augmentation contributing the plugin's service/manager handles to the
 * `ObsidianGemini` interface declared in `./plugin.ts` (see #1155).
 *
 * The service classes named here depend (directly or transitively) on the
 * plugin type themselves, so importing them from `./plugin.ts` would recreate
 * the very import cycles the interface exists to break. Declaring the handles
 * here reverses the edge: this file points at the services, the services point
 * at the leaf interface, and nothing points back at this file — no module ever
 * imports it; it participates in the compilation via tsconfig's `include` and
 * is erased entirely from the runtime bundle (all imports are type-only).
 *
 * When adding a service handle to the plugin class in `main.ts`, mirror it
 * here — the `implements` clause on the class will fail to compile until the
 * two stay in sync.
 */
declare module './plugin' {
	interface ObsidianGemini {
		// Public service properties — assigned by LifecycleService
		gfile: ScribeFile;
		agentView: AgentView;
		history: GeminiHistory;
		sessionHistory: SessionHistory;
		promptManager: PromptManager;
		prompts: GeminiPrompts;
		sessionManager: SessionManager;
		toolRegistry: ToolRegistry;
		toolExecutionEngine: ToolExecutionEngine;
		agentsMemory: AgentsMemory;
		examplePrompts: ExamplePromptsManager;
		vaultAnalyzer: VaultAnalyzer;
		deepResearch: DeepResearchService;
		imageGeneration: ImageGeneration | null;
		logger: Logger;
		fileLogWriter: FileLogWriter | null;
		ragIndexing: RagIndexingService | null;
		selectionActionService: SelectionActionService;
		mcpManager: MCPManager | null;
		skillManager: SkillManager;
		contextManager: ContextManager;
		folderInitializer: FolderInitializer | null;
		modelManager: ModelManager;
		completions: GeminiCompletions | null;
		summarizer: GeminiSummary | null;
		projectManager: ProjectManager;
		agentEventBus: AgentEventBus;
		toolExecutionLogger: ToolExecutionLogger | null;
		backgroundTaskManager: BackgroundTaskManager | null;
		backgroundStatusBar: BackgroundStatusBar | null;
		scheduledTaskManager: ScheduledTaskManager | null;
		hookManager: HookManager | null;

		/** Get the model manager instance */
		getModelManager(): ModelManager;
	}
}

/**
 * English source strings for the plugin UI — the single source of truth for i18n.
 *
 * Every user-visible string in migrated UI areas lives here, keyed as `area.component.element`.
 * The optional `context` is fed verbatim to the translation prompt (scripts/translate.mjs) to
 * disambiguate short labels; it is never shown to users.
 *
 * After changing a message or context, run `npm run translate` to regenerate the affected keys
 * in all language files (only keys whose English source changed are retranslated).
 */
export interface SourceString {
	message: string;
	context?: string;
}

export const en = {
	'agent.empty.title': {
		message: 'Start a conversation',
		context: "Heading of the agent chat panel's empty state, inviting the user to begin chatting.",
	},
	'agent.empty.description': {
		message: 'Your AI assistant that can actively work with your vault.',
		context: 'Subtitle under the empty-state heading. "Vault" is the Obsidian term for a notes folder.',
	},
	'agent.empty.capabilitiesTitle': {
		message: 'What can the agent do?',
		context: 'Section heading above a bullet list of agent capabilities.',
	},
	'agent.empty.capability.search': {
		message: 'Search and read files in your vault',
		context: 'Capability bullet item describing what the AI agent can do.',
	},
	'agent.empty.capability.organize': {
		message: 'Create, modify, and organize notes',
		context: 'Capability bullet item describing what the AI agent can do.',
	},
	'agent.empty.capability.web': {
		message: 'Search the web and fetch information',
		context: 'Capability bullet item describing what the AI agent can do.',
	},
	'agent.empty.capability.multiStep': {
		message: 'Execute multi-step tasks autonomously',
		context: 'Capability bullet item describing what the AI agent can do.',
	},
	'agent.empty.docsLink': {
		message: '📖 Learn more about agent mode',
		context: 'Hyperlink to documentation. Keep the leading book emoji. "Agent Mode" is a feature name.',
	},
	'agent.empty.docsLinkAria': {
		message: 'Open agent mode documentation in new tab',
		context: 'Accessibility label (aria-label) for the documentation link.',
	},
	'agent.empty.docsOpenFailed': {
		message: 'Failed to open documentation. Please check your browser settings.',
		context: 'Error notice shown when the documentation link cannot be opened.',
	},
	'agent.empty.updateContext': {
		message: 'Update vault context',
		context: 'Button label. Clicking asks the AI to refresh its stored summary of the vault.',
	},
	'agent.empty.updateContextDesc': {
		message: 'Refresh my understanding of your vault',
		context:
			'Button description under "Update Vault Context". "My" refers to the AI agent speaking about its own understanding.',
	},
	'agent.empty.initContext': {
		message: 'Initialize vault context',
		context: 'Button label. Clicking asks the AI to analyze the vault for the first time.',
	},
	'agent.empty.initContextDesc': {
		message: 'Help me understand your vault structure and organization',
		context:
			'Button description under "Initialize Vault Context". Phrased as the AI agent asking the user to let it analyze the vault.',
	},
	'agent.empty.recentSessions': {
		message: 'Recent sessions:',
		context: 'List header above recently used chat sessions. Keep the trailing colon.',
	},
	'agent.empty.examplesHeader': {
		message: 'Try these examples:',
		context: 'List header above example prompts the user can click. Keep the trailing colon.',
	},
	'i18n.aiTranslatedNotice': {
		message: 'This interface translation is AI-generated. Refinement PRs are welcome.',
		context:
			'Small footer notice shown when the UI is displayed in a non-English language. "PRs" means pull requests on GitHub.',
	},

	// --- settings ---
	'settings.common.saveFailedNotice': {
		message: 'Failed to save settings: {error}',
		context: 'Notice shown when persisting plugin settings to disk fails. {error} is the error message.',
	},
	'settings.common.advancedBadge': {
		message: 'Advanced',
		context: 'Small badge shown next to settings section titles intended for power users.',
	},
	'settings.general.sectionTitle': {
		message: 'General',
		context: 'Title of the always-open General section at the top of the settings tab.',
	},
	'settings.general.sectionDesc': {
		message: 'Set up your provider, API key, and the models the plugin uses. Required for the plugin to work.',
		context: 'Description under the General settings section title.',
	},
	'settings.general.documentationName': {
		message: 'Documentation',
		context: 'Settings field name for the row linking to plugin documentation.',
	},
	'settings.general.documentationDesc': {
		message: 'View the complete plugin documentation and guides',
		context: 'Settings field description for the documentation link row.',
	},
	'settings.general.viewDocumentationButton': {
		message: 'View documentation',
		context: 'Button label that opens the plugin documentation website in a browser.',
	},
	'settings.general.providerName': {
		message: 'Provider',
		context: 'Settings field name for choosing the AI model provider (Gemini or Ollama).',
	},
	'settings.general.providerDesc': {
		message:
			'Choose the model provider. Gemini uses the Google Cloud API. Ollama runs models locally on your machine; install from https://ollama.com and pull a model with `ollama pull <name>`.',
		context:
			'Settings field description for the provider dropdown. Keep the URL and the backtick-quoted shell command untranslated.',
	},
	'settings.general.providerOptionGemini': {
		message: 'Google Gemini (cloud)',
		context: 'Dropdown option label for the Google Gemini cloud provider. "Google Gemini" is a product name.',
	},
	'settings.general.providerOptionOllama': {
		message: 'Ollama (local)',
		context: 'Dropdown option label for the Ollama local provider. "Ollama" is a product name.',
	},
	'settings.general.ollamaBaseUrlName': {
		message: 'Ollama base URL',
		context: 'Settings field name for the URL of the local Ollama server. Shown only when Ollama provider is selected.',
	},
	'settings.general.ollamaBaseUrlDesc': {
		message: 'HTTP endpoint of your local Ollama daemon. Default is http://localhost:11434.',
		context: 'Settings field description for the Ollama base URL input. Keep the URL untranslated.',
	},
	'settings.general.refreshModelListName': {
		message: 'Refresh model list',
		context:
			'Settings field name for the button that re-fetches available models. Used for both Gemini and Ollama providers.',
	},
	'settings.general.refreshModelListOllamaDesc': {
		message: 'Re-query the Ollama daemon for available models.',
		context: 'Settings field description for the refresh-models row when the Ollama provider is active.',
	},
	'settings.general.refreshModelListGeminiDesc': {
		message:
			'Fetch the latest Gemini model list from GitHub now, bypassing the 24h cache. Use this after a new model is published.',
		context: 'Settings field description for the refresh-models row when the Gemini provider is active.',
	},
	'settings.general.refreshButton': {
		message: 'Refresh',
		context: 'Button label that triggers a refresh of the available model list.',
	},
	'settings.general.ollamaModelsFoundSingular': {
		message: 'Found {count} Ollama model.',
		context: 'Notice after refreshing the Ollama model list when exactly one model was found. {count} is the number 1.',
	},
	'settings.general.ollamaModelsFound': {
		message: 'Found {count} Ollama models.',
		context: 'Notice after refreshing the Ollama model list. {count} is the number of models found (0 or 2+).',
	},
	'settings.general.refreshFailedNotice': {
		message: 'Failed to refresh: {error}',
		context: 'Notice when refreshing the Ollama model list fails. {error} is the error message.',
	},
	'settings.general.localOnlyNoticeName': {
		message: 'Local-only feature notice',
		context: 'Settings field name of an informational row shown when the local Ollama provider is selected.',
	},
	'settings.general.localOnlyNoticeDesc': {
		message:
			'Google Search, URL Context (web fetch), Deep Research, image generation, and RAG indexing are unavailable when using Ollama. They rely on Gemini built-in services.',
		context:
			'Informational description listing cloud-only features unavailable with the local Ollama provider. Feature names are plugin features.',
	},
	'settings.general.apiKeyName': {
		message: 'API key',
		context: 'Settings field name for the Google Gemini API key input.',
	},
	'settings.general.apiKeyDesc': {
		message:
			'Link your Google Gemini API key. Click "Link..." and Obsidian will ask for a secret name (this is just a label — use any name like "gemini-api") and a secret value (paste your API key here). Get a key free at https://aistudio.google.com/apikey',
		context:
			'Settings field description for the API key. "Link...", "Secret Name", and "Secret Value" refer to Obsidian secret-storage UI labels. Keep the URL untranslated.',
	},
	'settings.general.chatModelName': {
		message: 'Chat model',
		context: 'Settings field name for the model used in agent chat.',
	},
	'settings.general.chatModelDesc': {
		message: 'Model used for agent chat sessions, selection rewriting, and web search tools.',
		context: 'Settings field description for the chat model dropdown.',
	},
	'settings.general.summaryModelName': {
		message: 'Summary model',
		context: 'Settings field name for the model used to summarize notes.',
	},
	'settings.general.summaryModelDesc': {
		message: 'Model used for the "Summarize active file" command that adds summaries to frontmatter.',
		context:
			'Settings field description for the summary model dropdown. "Summarize Active File" is a command name in the plugin.',
	},
	'settings.general.completionModelName': {
		message: 'Completion model',
		context: 'Settings field name for the model used for inline text completions.',
	},
	'settings.general.completionModelDesc': {
		message: 'Model used for IDE-style inline completions as you type in notes.',
		context: 'Settings field description for the completion model dropdown.',
	},
	'settings.general.imageModelName': {
		message: 'Image model',
		context: 'Settings field name for the model used to generate images.',
	},
	'settings.general.imageModelDesc': {
		message: 'Model used for image generation.',
		context: 'Settings field description for the image generation model dropdown.',
	},
	'settings.general.stateFolderName': {
		message: 'Plugin state folder',
		context: 'Settings field name for the vault folder where the plugin stores its data.',
	},
	'settings.general.stateFolderDesc': {
		message:
			'Folder where plugin data is stored. Agent sessions live under Agent-Sessions/, custom prompts under Prompts/, hooks under Hooks/, scheduled task state under Scheduled-Tasks/.',
		context:
			'Settings field description for the plugin state folder. The folder names ending in / are literal subfolder names and must stay untranslated.',
	},
	'settings.general.showAdvancedName': {
		message: 'Show advanced settings',
		context: 'Settings field name for the toggle that reveals advanced settings sections.',
	},
	'settings.general.showAdvancedDesc': {
		message:
			'Reveal advanced sections (Custom prompts, API configuration, Tool permissions, Tool loop detection, MCP servers, Debug) for power users.',
		context:
			'Settings field description for the show-advanced toggle. The parenthesized names are section titles elsewhere in settings; translate them consistently with those section titles.',
	},
	'settings.general.modelListUpdatedSingular': {
		message: 'Model list updated: {count} model.',
		context:
			'Notice after a successful Gemini model list refresh when exactly one model is available. {count} is the number 1.',
	},
	'settings.general.modelListUpdated': {
		message: 'Model list updated: {count} models.',
		context: 'Notice after a successful Gemini model list refresh. {count} is the number of models (0 or 2+).',
	},
	'settings.general.refreshSkippedOffline': {
		message: 'Skipped: offline',
		context: 'Notice when a model list refresh was skipped because the device is offline.',
	},
	'settings.general.refreshSkippedNotGemini': {
		message: 'Skipped: provider is not Gemini',
		context: 'Notice when a model list refresh was skipped because the selected provider is not Gemini.',
	},
	'settings.general.refreshModelListFailed': {
		message: 'Failed to refresh model list: {error}',
		context: 'Notice when fetching the latest Gemini model list fails. {error} is the error message.',
	},
	'settings.ui.sectionTitle': { message: 'User experience', context: 'Title of the User Experience settings section.' },
	'settings.ui.sectionDesc': {
		message:
			'Streaming, diff view, scheduler catch-up, and personalization options that affect how you interact with the plugin.',
		context: 'Description under the User Experience settings section title.',
	},
	'settings.ui.userNameName': {
		message: 'Your name',
		context: 'Settings field name for the user name input used to personalize AI responses.',
	},
	'settings.ui.userNameDesc': {
		message: 'Your name used in system instructions so the AI can address you personally in conversations.',
		context: 'Settings field description for the user name input.',
	},
	'settings.ui.userNamePlaceholder': {
		message: 'Enter your name',
		context: 'Placeholder text inside the user name text input.',
	},
	'settings.ui.summaryFrontmatterKeyName': {
		message: 'Summary frontmatter key',
		context:
			'Settings field name for the frontmatter property name where note summaries are written. "Frontmatter" is an Obsidian/Markdown term.',
	},
	'settings.ui.summaryFrontmatterKeyDesc': {
		message: 'Frontmatter property name where summaries are stored when using "Summarize active file" command.',
		context: 'Settings field description. "Summarize Active File" is a plugin command name.',
	},
	'settings.ui.enableStreamingName': {
		message: 'Enable streaming',
		context: 'Settings toggle name for streaming AI responses word-by-word.',
	},
	'settings.ui.enableStreamingDesc': {
		message: 'Stream AI responses word-by-word as they are generated for a more interactive chat experience.',
		context: 'Settings toggle description for streaming responses.',
	},
	'settings.ui.alwaysShowDiffViewName': {
		message: 'Always show diff view for file writes',
		context: 'Settings toggle name. A diff view shows proposed file changes side by side.',
	},
	'settings.ui.alwaysShowDiffViewDesc': {
		message:
			'Automatically open a diff view when the agent proposes file changes, instead of requiring a button click.',
		context: 'Settings toggle description for automatically opening the diff view.',
	},
	'settings.ui.sessionHistoryName': {
		message: 'Enable session history',
		context: 'Settings toggle name for persisting agent chat sessions to disk.',
	},
	'settings.ui.sessionHistoryDesc': {
		message:
			'Persist agent chat sessions as markdown files in your vault. Sessions are saved under Agent-Sessions/ with auto-generated titles.',
		context:
			'Settings toggle description. "Agent-Sessions/" is a literal folder name and must stay untranslated. "Vault" is the Obsidian term for a notes folder.',
	},
	'settings.ui.logToolExecutionName': {
		message: 'Log tool execution to session history',
		context: 'Settings toggle name for recording agent tool runs in the session history file.',
	},
	'settings.ui.logToolExecutionDesc': {
		message:
			'Append a summary of each tool execution to the session history file for auditing. Requires session history to be enabled. Requires plugin reload to take effect.',
		context:
			'Settings toggle description. "Session History" refers to the setting named by settings.ui.sessionHistoryName; translate consistently.',
	},
	'settings.automation.sectionTitle': {
		message: 'Automation',
		context: 'Title of the Automation settings section (scheduled tasks and lifecycle hooks).',
	},
	'settings.automation.sectionDesc': {
		message:
			'Run AI agent tasks automatically — on a schedule, or in response to vault events (file created/modified/deleted/renamed).',
		context: 'Description under the Automation settings section title.',
	},
	'settings.automation.manageScheduledTasksName': {
		message: 'Manage scheduled tasks',
		context: 'Settings field name for the row with buttons to open the scheduled-task manager.',
	},
	'settings.automation.manageScheduledTasksDesc': {
		message:
			'Create, edit, enable/disable, and delete scheduled AI tasks. Tasks run automatically in the background while Obsidian is open.',
		context: 'Settings field description for the scheduled task management row.',
	},
	'settings.automation.openSchedulerButton': {
		message: 'Open scheduler',
		context: 'Button label that opens the scheduled-task management dialog.',
	},
	'settings.automation.newTaskButton': {
		message: 'New task',
		context: 'Button label that opens the dialog to create a new scheduled task.',
	},
	'settings.automation.autoRunCatchUpName': {
		message: 'Auto-run missed scheduled tasks on startup',
		context:
			'Settings toggle name for automatically running scheduled tasks that were missed while Obsidian was closed.',
	},
	'settings.automation.autoRunCatchUpDesc': {
		message:
			'When enabled, tasks that were missed while Obsidian was closed (and have "Run if missed" set) are submitted automatically on startup without showing the approval modal.',
		context: 'Settings toggle description. "Run if missed" is a per-task option label in the scheduler dialog.',
	},
	'settings.automation.enableHooksName': {
		message: 'Enable lifecycle hooks',
		context: 'Settings toggle name for the lifecycle hooks feature (running agent tasks in response to vault events).',
	},
	'settings.automation.enableHooksDesc': {
		message:
			'Subscribe to vault events and run AI agent tasks in response. Off by default — vault events fire continuously, and a broadly-scoped hook can drain API quota quickly.',
		context:
			'Settings toggle description warning that hooks can consume API quota. "Vault" is the Obsidian term for a notes folder.',
	},
	'settings.automation.manageHooksName': {
		message: 'Manage lifecycle hooks',
		context: 'Settings field name for the row with buttons to open the hook manager.',
	},
	'settings.automation.manageHooksDesc': {
		message:
			'Create, edit, enable/disable, and delete hooks. Each hook fires when a matching vault event occurs and runs as a headless agent session.',
		context: 'Settings field description for the hook management row.',
	},
	'settings.automation.openHookManagerButton': {
		message: 'Open hook manager',
		context: 'Button label that opens the lifecycle hook management dialog.',
	},
	'settings.automation.newHookButton': {
		message: 'New hook',
		context: 'Button label that opens the dialog to create a new lifecycle hook.',
	},
	'settings.debug.sectionTitle': { message: 'Debug', context: 'Title of the Debug settings section.' },
	'settings.debug.sectionDesc': {
		message: 'Diagnostic toggles for troubleshooting plugin behavior.',
		context: 'Description under the Debug settings section title.',
	},
	'settings.debug.debugModeName': {
		message: 'Debug mode',
		context: 'Settings toggle name for enabling debug console logging.',
	},
	'settings.debug.debugModeDesc': {
		message: 'Enable debug logging to the console. Useful for troubleshooting.',
		context: 'Settings toggle description for debug mode.',
	},
	'settings.debug.showTokenUsageName': {
		message: 'Show token usage',
		context: 'Settings toggle name for displaying estimated AI token usage in the agent view.',
	},
	'settings.debug.showTokenUsageDesc': {
		message: 'Display estimated token usage in the agent view (for debugging purposes).',
		context: 'Settings toggle description. "Token" is the AI/LLM unit of text, not a security token.',
	},
	'settings.debug.stopOnToolErrorName': {
		message: 'Stop on tool error',
		context: 'Settings toggle name for halting agent execution when a tool call fails.',
	},
	'settings.debug.stopOnToolErrorDesc': {
		message:
			'Stop agent execution when a tool call fails. If disabled, the agent will continue executing subsequent tools.',
		context: 'Settings toggle description for the stop-on-tool-error behavior.',
	},
	'settings.agentConfig.sectionTitle': {
		message: 'Agent config',
		context: 'Title of the advanced Agent Config settings section.',
	},
	'settings.agentConfig.sectionDesc': {
		message:
			'Tune how the agent talks to the model: custom prompts, retry/generation parameters, conversation summarization, and loop guards.',
		context: 'Description under the Agent Config settings section title.',
	},
	'settings.agentConfig.customPromptsHeading': {
		message: 'Custom prompts',
		context: 'Sub-heading inside Agent Config settings, above custom prompt options.',
	},
	'settings.agentConfig.systemPromptOverrideName': {
		message: 'Allow system prompt override',
		context: 'Settings toggle name allowing custom prompts to replace the built-in system prompt.',
	},
	'settings.agentConfig.systemPromptOverrideDesc': {
		message:
			'WARNING: Allows custom prompts to completely replace the system prompt. This may break expected functionality.',
		context: 'Settings toggle description with a warning about replacing the AI system prompt.',
	},
	'settings.agentConfig.apiConfigurationHeading': {
		message: 'API configuration',
		context: 'Sub-heading inside Agent Config settings, above API retry/endpoint options.',
	},
	'settings.agentConfig.logToFileName': {
		message: 'Log to file',
		context: 'Settings toggle name for writing log entries to a file.',
	},
	'settings.agentConfig.logToFileDesc': {
		message:
			'Write log entries to a file in the plugin state folder. Errors and warnings are always logged; debug entries require debug mode. Log files are automatically rotated at 1 MB.',
		context:
			'Settings toggle description for file logging. "Debug Mode" refers to the setting named by settings.debug.debugModeName; translate consistently.',
	},
	'settings.agentConfig.useInteractionsApiName': {
		message: 'Use Interactions API',
		context: 'Settings toggle name for routing Gemini requests through the GA Interactions API.',
	},
	'settings.agentConfig.useInteractionsApiDesc': {
		message:
			'Route Gemini requests through Google’s newer Interactions API instead of the legacy generateContent API. Runs statelessly — conversation history is replayed each turn and not persisted on Google’s side between turns. Experimental — leave off if you hit issues.',
		context:
			'Settings toggle description for the Interactions API. "Interactions API" and "generateContent" are Google API names; keep them in English.',
	},
	'settings.agentConfig.customEndpointName': {
		message: 'Custom API endpoint',
		context: 'Settings field name for overriding the Google API base URL.',
	},
	'settings.agentConfig.customEndpointDesc': {
		message:
			'Override the default Google API base URL (e.g. for a corporate proxy or local gateway). Leave blank to use the official endpoint.',
		context: 'Settings field description for the custom API endpoint input.',
	},
	'settings.agentConfig.customEndpointInvalidNotice': {
		message: 'Custom API endpoint is not a valid URL — clearing.',
		context: 'Notice shown when the entered custom API endpoint fails URL validation and is reset to empty.',
	},
	'settings.agentConfig.maxRetriesName': {
		message: 'Maximum retries',
		context: 'Settings field name for the maximum number of retries on failed model requests.',
	},
	'settings.agentConfig.maxRetriesDesc': {
		message: 'Maximum number of retries when a model request fails.',
		context: 'Settings field description for the maximum retries input.',
	},
	'settings.agentConfig.maxRetriesPlaceholder': {
		message: 'e.g., 3',
		context: 'Placeholder showing an example value (the number 3) in the maximum retries text input.',
	},
	'settings.agentConfig.initialBackoffName': {
		message: 'Initial backoff delay (ms)',
		context: 'Settings field name for the initial retry delay in milliseconds. "ms" abbreviates milliseconds.',
	},
	'settings.agentConfig.initialBackoffDesc': {
		message: 'Initial delay in milliseconds before the first retry. Subsequent retries will use exponential backoff.',
		context: 'Settings field description for the initial backoff delay input.',
	},
	'settings.agentConfig.initialBackoffPlaceholder': {
		message: 'e.g., 1000',
		context: 'Placeholder showing an example value (the number 1000) in the initial backoff delay text input.',
	},
	'settings.agentConfig.contextManagementHeading': {
		message: 'Context management',
		context: 'Sub-heading inside Agent Config settings, above conversation context options.',
	},
	'settings.agentConfig.compactionThresholdName': {
		message: 'Context compaction threshold',
		context: 'Settings slider name for the token-usage percentage that triggers conversation summarization.',
	},
	'settings.agentConfig.compactionThresholdDesc': {
		message:
			'Automatically summarize older conversation turns when token usage exceeds this percentage of the model context window. Current: {percent}%',
		context:
			'Settings slider description. {percent} is the currently selected number, displayed before a percent sign.',
	},
	'settings.agentConfig.loopDetectionHeading': {
		message: 'Tool loop detection',
		context: 'Sub-heading inside Agent Config settings, above loop detection options.',
	},
	'settings.agentConfig.loopDetectionName': {
		message: 'Enable loop detection',
		context: 'Settings toggle name for detecting repeated identical AI tool calls.',
	},
	'settings.agentConfig.loopDetectionDesc': {
		message: 'Prevent the AI from repeatedly calling the same tool with identical parameters.',
		context: 'Settings toggle description for loop detection.',
	},
	'settings.agentConfig.loopThresholdName': {
		message: 'Loop threshold',
		context: 'Settings slider name for how many identical tool calls count as a loop.',
	},
	'settings.agentConfig.loopThresholdDesc': {
		message: 'Number of identical tool calls before considering it a loop (default: 3).',
		context: 'Settings slider description for the loop threshold.',
	},
	'settings.agentConfig.timeWindowName': {
		message: 'Time window (seconds)',
		context: 'Settings slider name for the loop-detection time window in seconds.',
	},
	'settings.agentConfig.timeWindowDesc': {
		message: 'Time window to check for repeated calls (default: 30 seconds).',
		context: 'Settings slider description for the loop-detection time window.',
	},
	'settings.agentConfig.temperatureName': {
		message: 'Temperature',
		context: 'Settings slider name. "Temperature" is the standard AI generation parameter controlling randomness.',
	},
	'settings.agentConfig.temperatureDescWithInfo': {
		message: 'Controls randomness. Lower values are more deterministic. {info}',
		context:
			'Settings slider description for temperature. {info} is an English range/default string supplied by the model metadata, appended verbatim.',
	},
	'settings.agentConfig.temperatureDescDefault': {
		message: 'Controls randomness. Lower values are more deterministic. (Default: 0.7)',
		context: 'Settings slider description for temperature when no model metadata is available.',
	},
	'settings.agentConfig.temperatureSaveFailedNotice': {
		message: 'Failed to save temperature setting. See console for details.',
		context: 'Notice when saving the temperature setting fails.',
	},
	'settings.agentConfig.topPName': {
		message: 'Top P',
		context: 'Settings slider name. "Top P" is the standard AI nucleus-sampling parameter; usually left untranslated.',
	},
	'settings.agentConfig.topPDescWithInfo': {
		message: 'Controls diversity. Lower values are more focused. {info}',
		context:
			'Settings slider description for Top P. {info} is an English range/default string supplied by the model metadata, appended verbatim.',
	},
	'settings.agentConfig.topPDescDefault': {
		message: 'Controls diversity. Lower values are more focused. (Default: 1)',
		context: 'Settings slider description for Top P when no model metadata is available.',
	},
	'settings.agentConfig.topPSaveFailedNotice': {
		message: 'Failed to save Top P setting. See console for details.',
		context: 'Notice when saving the Top P setting fails.',
	},
	'settings.mcp.sectionTitle': {
		message: 'MCP servers',
		context:
			'Title of the MCP Servers settings section. MCP stands for Model Context Protocol; usually left untranslated.',
	},
	'settings.mcp.sectionDesc': {
		message: 'Connect external Model Context Protocol servers to extend the agent with additional tools.',
		context: 'Description under the MCP Servers settings section title.',
	},
	'settings.mcp.loadErrorDesc': {
		message: 'Error loading MCP settings: {error}',
		context:
			'Fallback settings row description shown when the MCP settings section fails to render. {error} is the error message.',
	},
	'settings.mcp.enableName': {
		message: 'Enable MCP servers',
		context: 'Settings toggle name for the MCP server integration.',
	},
	'settings.mcp.enableDesc': {
		message:
			'Connect to Model Context Protocol servers to extend the agent with external tools. Supports local (stdio) and remote (HTTP) servers.',
		context: 'Settings toggle description. "stdio" and "HTTP" are technical transport names; keep untranslated.',
	},
	'settings.mcp.noServers': {
		message: 'No MCP servers configured. Click "Add server" to get started.',
		context:
			'Empty-state text in the MCP server list. "Add Server" refers to the button labeled by settings.mcp.addServerButton; translate consistently.',
	},
	'settings.mcp.httpUrl': {
		message: 'HTTP: {url}',
		context: 'Part of a server description line showing the remote server URL. {url} is the server address.',
	},
	'settings.mcp.authorized': {
		message: 'Authorized ✓',
		context: 'Status tag in a server description indicating OAuth authorization completed. Keep the check mark.',
	},
	'settings.mcp.editButton': { message: 'Edit', context: 'Button label to edit an MCP server configuration.' },
	'settings.mcp.deleteButton': { message: 'Delete', context: 'Button label to delete an MCP server configuration.' },
	'settings.mcp.addServerButton': { message: 'Add server', context: 'Button label to add a new MCP server.' },
	'settings.mcp.duplicateServerName': {
		message: 'A server named "{name}" already exists',
		context: 'Notice when saving an MCP server whose name duplicates an existing one. {name} is the server name.',
	},
	'settings.mcp.reconnectFailed': {
		message: 'Failed to reconnect "{name}": {error}',
		context:
			'Notice when reconnecting to an MCP server after editing fails. {name} is the server name, {error} the error message.',
	},
	'settings.mcp.openEditorFailed': {
		message: 'Failed to open server editor: {error}',
		context: 'Notice when the MCP server edit dialog fails to open. {error} is the error message.',
	},
	'settings.mcp.savedButConnectFailed': {
		message: 'Server saved but failed to connect: {error}',
		context: 'Notice when a new MCP server was saved but the initial connection failed. {error} is the error message.',
	},
	'settings.mcp.openAddDialogFailed': {
		message: 'Failed to open add server dialog: {error}',
		context:
			'Notice when the Add Server dialog fails to open. {error} is the error message. "Add Server" refers to settings.mcp.addServerButton; translate consistently.',
	},
	'settings.rag.sectionTitle': {
		message: 'Vault search index',
		context:
			'Title of the settings section for the semantic vault search index. "Vault" is the Obsidian term for a notes folder.',
	},
	'settings.rag.sectionDesc': {
		message:
			'Semantic search across your vault using Google File Search. Powers retrieval-augmented agent responses. Privacy: indexed files are uploaded to Google Cloud.',
		context:
			'Description under the Vault Search Index section title. "Google File Search" and "Google Cloud" are product names.',
	},
	'settings.rag.privacyNotice': {
		message:
			'⚠️ Privacy notice: Enabling this feature uploads your vault files to Google Cloud for semantic search. Files are processed and stored by Google. Consider excluding folders with sensitive information.',
		context: 'Privacy warning paragraph at the top of the Vault Search Index section. Keep the warning emoji.',
	},
	'settings.rag.enableName': {
		message: 'Enable vault indexing',
		context: 'Settings toggle name for the vault search indexing feature.',
	},
	'settings.rag.enableDesc': {
		message: 'Index your vault files for semantic search using Google File Search.',
		context: 'Settings toggle description for vault indexing.',
	},
	'settings.rag.openCleanupFailed': {
		message: 'Failed to open cleanup dialog: {error}',
		context:
			'Notice when the index-cleanup confirmation dialog fails to open while disabling indexing. {error} is the error message.',
	},
	'settings.rag.filesIndexed': {
		message: '{count} files indexed',
		context: 'Index status text showing how many files are in the search index. {count} is the file count.',
	},
	'settings.rag.notYetIndexed': {
		message: 'Not yet indexed',
		context: 'Index status text when the vault has never been indexed.',
	},
	'settings.rag.indexStatusName': {
		message: 'Index status',
		context: 'Settings field name for the row showing index state with reindex/delete buttons.',
	},
	'settings.rag.reindexButton': {
		message: 'Reindex vault',
		context: 'Button label that rebuilds the vault search index.',
	},
	'settings.rag.indexingButton': {
		message: 'Indexing...',
		context: 'Temporary button label while the vault is being indexed.',
	},
	'settings.rag.serviceNotInitialized': {
		message: 'RAG indexing service not initialized',
		context:
			'Notice when an indexing action is attempted before the indexing service is ready. RAG stands for retrieval-augmented generation.',
	},
	'settings.rag.indexResult': {
		message: 'Indexed {indexed} files ({skipped} skipped, {failed} failed)',
		context: 'Notice summarizing an indexing run. {indexed}, {skipped}, and {failed} are file counts.',
	},
	'settings.rag.indexingFailed': {
		message: 'Indexing failed: {error}',
		context: 'Notice when vault indexing fails. {error} is the error message.',
	},
	'settings.rag.deleteIndexButton': {
		message: 'Delete index',
		context: 'Button label that deletes the vault search index.',
	},
	'settings.rag.deletingButton': {
		message: 'Deleting...',
		context: 'Temporary button label while the search index is being deleted.',
	},
	'settings.rag.indexDeletedNotice': {
		message: 'Index deleted. Use "Reindex vault" to rebuild.',
		context:
			'Notice after the search index was deleted. "Reindex Vault" refers to the button labeled by settings.rag.reindexButton; translate consistently.',
	},
	'settings.rag.deleteIndexFailed': {
		message: 'Failed to delete index: {error}',
		context: 'Notice when deleting the search index fails. {error} is the error message.',
	},
	'settings.rag.openDeleteConfirmFailed': {
		message: 'Failed to open delete confirmation: {error}',
		context: 'Notice when the delete-index confirmation dialog fails to open. {error} is the error message.',
	},
	'settings.rag.storeNameName': {
		message: 'Search index name',
		context: 'Settings field name for the read-only Google File Search store identifier.',
	},
	'settings.rag.storeNameDescAssigned': {
		message:
			'The Google File Search store identifier, assigned automatically. Delete the index to start over with a new one.',
		context: 'Settings field description when a search index store already exists.',
	},
	'settings.rag.storeNameDescPending': {
		message: 'Assigned automatically by Google File Search when indexing starts.',
		context: 'Settings field description when no search index store exists yet.',
	},
	'settings.rag.copyButton': {
		message: 'Copy',
		context: 'Button label that copies the search index store name to the clipboard.',
	},
	'settings.rag.copyTooltip': {
		message: 'Copy store name to clipboard',
		context: 'Tooltip on the Copy button for the search index store name.',
	},
	'settings.rag.storeNameCopiedNotice': {
		message: 'Store name copied to clipboard',
		context: 'Notice after the search index store name was copied to the clipboard.',
	},
	'settings.rag.autoSyncName': {
		message: 'Auto-sync changes',
		context: 'Settings toggle name for automatically keeping the search index in sync with file changes.',
	},
	'settings.rag.autoSyncDesc': {
		message: 'Automatically update the index when files are created, modified, or deleted.',
		context: 'Settings toggle description for index auto-sync.',
	},
	'settings.rag.includeAttachmentsName': {
		message: 'Include attachments',
		context: 'Settings toggle name for indexing non-markdown files such as PDFs.',
	},
	'settings.rag.includeAttachmentsDesc': {
		message: 'Index PDFs and other supported file types in addition to markdown notes. Requires reindexing.',
		context: 'Settings toggle description for including attachments in the search index.',
	},
	'settings.rag.attachmentSettingChangedNotice': {
		message: 'Attachment setting changed. Reindex vault to apply changes.',
		context: 'Notice after toggling attachment indexing, reminding the user to reindex.',
	},
	'settings.rag.excludeFoldersName': {
		message: 'Exclude folders',
		context: 'Settings field name for the textarea listing folders excluded from indexing.',
	},
	'settings.rag.excludeFoldersDesc': {
		message: 'Always excluded: {folders}. Add additional folders below (one per line).',
		context:
			'Settings field description for the exclude-folders textarea. {folders} is a comma-separated list of system folder paths that are always excluded.',
	},
	'settings.rag.excludeFoldersPlaceholder': {
		message: 'Additional folders to exclude...',
		context: 'Placeholder text inside the exclude-folders textarea.',
	},
	'settings.tools.sectionTitle': {
		message: 'Tool permissions',
		context: 'Title of the Tool Permissions settings section.',
	},
	'settings.tools.sectionDesc': {
		message: 'Control which agent tools require confirmation, run automatically, or are blocked entirely.',
		context: 'Description under the Tool Permissions settings section title.',
	},
	'settings.tools.noToolsName': {
		message: 'No tools registered',
		context: 'Settings field name shown when the agent tool registry is empty.',
	},
	'settings.tools.noToolsDesc': {
		message: 'Tool permissions will appear here once tools are loaded.',
		context: 'Settings field description shown when no agent tools are registered yet.',
	},
	'settings.tools.presetName': {
		message: 'Permission preset',
		context: 'Settings dropdown name for choosing a tool-permission preset.',
	},
	'settings.tools.presetDesc': {
		message: 'Choose a preset that determines default permissions for all tools.',
		context: 'Settings dropdown description for the permission preset.',
	},
	'settings.tools.yoloConfirmFailed': {
		message: 'Failed to open YOLO confirmation: {error}',
		context:
			'Notice when the confirmation dialog for the unrestricted "YOLO" permission preset fails to open. {error} is the error message. YOLO is the preset name; keep untranslated.',
	},

	// --- modals ---
	'explainPrompt.placeholder': {
		message: 'Select a prompt to explain the selection...',
		context: 'Search placeholder in the suggest modal for picking an explain-selection prompt.',
	},
	'ragCleanup.title': {
		message: 'Delete vault index?',
		context:
			'Heading of the modal shown when the user disables RAG indexing, asking whether to delete the cloud index.',
	},
	'ragCleanup.body': {
		message: 'Your vault index is stored in Google Cloud. Do you want to delete it?',
		context: 'Body text of the RAG cleanup modal.',
	},
	'ragCleanup.keepNote': {
		message: 'If you keep the data, re-enabling will be faster.',
		context: 'Note in the RAG cleanup modal explaining the benefit of keeping the index.',
	},
	'ragCleanup.deleteWarning': {
		message:
			"⚠️ If you delete, this action is permanent and cannot be undone. All indexed data will be permanently removed from Google Cloud, and you'll need to reindex all files.",
		context: 'Warning text in the RAG cleanup modal about the consequences of deleting the index.',
	},
	'ragCleanup.keepButton': {
		message: 'Keep data',
		context: 'Button in the RAG cleanup modal that keeps the cloud index.',
	},
	'ragCleanup.deleteButton': {
		message: 'Delete permanently',
		context: 'Destructive button in the RAG cleanup modal that deletes the cloud index.',
	},
	'yolo.title': {
		message: 'Enable YOLO mode?',
		context:
			'Heading of the confirmation modal for YOLO Mode (auto-approve all agent tool calls). "YOLO Mode" is a product feature name; keep it as-is.',
	},
	'yolo.description': {
		message:
			'YOLO mode allows the AI agent to execute all tools without any confirmation — including creating, editing, deleting, and moving files, as well as external API calls.',
		context: 'Body text of the YOLO Mode confirmation modal.',
	},
	'yolo.warning': {
		message:
			'⚠️ This grants the AI full, unsupervised access to your vault and external services. There is no undo for destructive operations.',
		context: 'Bold warning paragraph in the YOLO Mode confirmation modal.',
	},
	'yolo.trustNote': {
		message: 'Only enable this if you fully trust the AI model and understand the potential consequences.',
		context: 'Final caution paragraph in the YOLO Mode confirmation modal.',
	},
	'yolo.cancelButton': {
		message: 'Cancel',
		context: 'Button in the YOLO Mode confirmation modal that cancels enabling the mode.',
	},
	'yolo.enableButton': {
		message: 'Enable YOLO mode',
		context: 'Destructive-styled button that confirms enabling YOLO Mode. Keep the feature name "YOLO Mode".',
	},
	'rewrite.titleFile': {
		message: 'Rewrite entire file',
		context: 'Heading of the AI rewrite modal when rewriting the whole file.',
	},
	'rewrite.titleSelection': {
		message: 'Rewrite selected text',
		context: 'Heading of the AI rewrite modal when rewriting a text selection.',
	},
	'rewrite.fileContentLabel': {
		message: 'File content:',
		context: 'Label above the preview of the file content in the rewrite modal.',
	},
	'rewrite.selectedTextLabel': {
		message: 'Selected text:',
		context: 'Label above the preview of the selected text in the rewrite modal.',
	},
	'rewrite.instructionsLabel': {
		message: 'Instructions:',
		context: 'Label above the textarea where the user types rewrite instructions.',
	},
	'rewrite.placeholderFile': {
		message:
			'How would you like to rewrite this file?\n\nExamples:\n• Make it more concise\n• Fix grammar and spelling throughout\n• Convert to a different format\n• Reorganize the structure\n• Improve clarity and readability',
		context:
			'Multi-line placeholder in the rewrite-instructions textarea when rewriting a whole file. Keep the \n line breaks and bullet characters.',
	},
	'rewrite.placeholderSelection': {
		message:
			'How would you like to rewrite this text?\n\nExamples:\n• Make it more concise\n• Fix grammar and spelling\n• Make it more formal/casual\n• Expand with more detail\n• Simplify the language',
		context:
			'Multi-line placeholder in the rewrite-instructions textarea when rewriting a selection. Keep the \n line breaks and bullet characters.',
	},
	'rewrite.submitButton': {
		message: 'Rewrite',
		context: 'Primary submit button in the rewrite modal that starts the AI rewrite.',
	},
	'catchUp.title': {
		message: 'Missed scheduled runs',
		context: 'Heading of the startup modal listing scheduled tasks that were missed while Obsidian was closed.',
	},
	'catchUp.description': {
		message: 'The following tasks were scheduled to run while Obsidian was closed. Choose which ones to run now.',
		context: 'Description under the catch-up modal heading.',
	},
	'catchUp.runAllButton': {
		message: 'Run all',
		context: 'Button in the catch-up modal that runs every missed scheduled task.',
	},
	'catchUp.skipAllButton': {
		message: 'Skip all',
		context: 'Button in the catch-up modal that skips every missed scheduled task without running it.',
	},
	'catchUp.runAllFailed': {
		message: 'Some tasks failed to run — check logs for details.',
		context: 'Notice shown when the "Run all" action in the catch-up modal partially fails.',
	},
	'catchUp.skipAllFailed': {
		message: 'Some tasks failed to skip — check logs for details.',
		context: 'Notice shown when the "Skip all" action in the catch-up modal partially fails.',
	},
	'catchUp.empty': {
		message: 'No pending runs.',
		context: 'Empty-state row in the catch-up modal list when no missed tasks remain.',
	},
	'catchUp.missedAge': {
		message: 'missed {age}',
		context:
			'Label next to a task in the catch-up modal. {age} is a relative time like "5m ago". Lowercase intentional; appears mid-row after the task name.',
	},
	'catchUp.runButton': { message: 'Run', context: 'Per-row button in the catch-up modal that runs one missed task.' },
	'catchUp.skipButton': {
		message: 'Skip',
		context: 'Per-row button in the catch-up modal that skips one missed task.',
	},
	'catchUp.runFailed': {
		message: 'Failed to run "{slug}" — check logs for details.',
		context: 'Notice when running one missed task fails. {slug} is the task identifier.',
	},
	'catchUp.skipFailed': {
		message: 'Failed to skip "{slug}" — check logs for details.',
		context: 'Notice when skipping one missed task fails. {slug} is the task identifier.',
	},
	'catchUp.minutesAgo': {
		message: '{count}m ago',
		context: 'Compact relative time in the catch-up modal: minutes ago. Keep it short.',
	},
	'catchUp.hoursAgo': {
		message: '{count}h ago',
		context: 'Compact relative time in the catch-up modal: hours ago. Keep it short.',
	},
	'catchUp.daysAgo': {
		message: '{count}d ago',
		context: 'Compact relative time in the catch-up modal: days ago. Keep it short.',
	},
	'ragResume.title': {
		message: 'Resume indexing?',
		context: 'Heading of the modal asking whether to resume an interrupted vault indexing operation.',
	},
	'ragResume.body': {
		message: 'A previous indexing operation was interrupted. Would you like to resume or start fresh?',
		context: 'Body text of the resume-indexing modal.',
	},
	'ragResume.filesIndexedLabel': {
		message: 'Files indexed:',
		context: 'Stat label in the resume-indexing modal, followed by a number.',
	},
	'ragResume.interruptedLabel': {
		message: 'Interrupted:',
		context: 'Stat label in the resume-indexing modal, followed by a relative time like "3 hours ago".',
	},
	'ragResume.lastFileLabel': {
		message: 'Last file:',
		context: 'Stat label in the resume-indexing modal, followed by a file path.',
	},
	'ragResume.resumeNote': {
		message: 'Resume will continue from where you left off, skipping already-indexed files.',
		context: 'Note in the resume-indexing modal explaining the resume behavior.',
	},
	'ragResume.resumeButton': {
		message: 'Resume',
		context: 'Primary button in the resume-indexing modal that continues the interrupted indexing.',
	},
	'ragResume.startFreshButton': {
		message: 'Start fresh',
		context: 'Warning-styled button in the resume-indexing modal that restarts indexing from scratch.',
	},
	'scheduledTasks.title': {
		message: 'Scheduled tasks',
		context: 'Heading of the modal listing scheduled agent tasks with their next-run time and status.',
	},
	'scheduledTasks.managerUnavailable': {
		message: 'Scheduled task manager not available.',
		context: 'Error text in the scheduled tasks modal when the scheduler service is not running.',
	},
	'scheduledTasks.empty': {
		message: 'No scheduled tasks found. Create a markdown file in the Scheduled-Tasks folder to get started.',
		context:
			'Empty state of the scheduled tasks modal. "Scheduled-Tasks" is a literal folder name; do not translate it.',
	},
	'scheduledTasks.badgeDisabled': {
		message: '{schedule} · disabled',
		context:
			'Badge next to a task. {schedule} is the raw schedule string (e.g. "daily 09:00"); translate only "disabled".',
	},
	'scheduledTasks.badgePaused': {
		message: '{schedule} · paused',
		context:
			'Badge next to a task paused due to repeated errors. {schedule} is the raw schedule string; translate only "paused".',
	},
	'scheduledTasks.onceComplete': {
		message: 'Once — complete',
		context: 'Shown in place of the next-run time for one-time tasks that already ran.',
	},
	'scheduledTasks.nextRun': {
		message: 'Next: {time}',
		context: 'Metadata row showing the next scheduled run. {time} is a formatted date or "Once — complete".',
	},
	'scheduledTasks.lastRun': {
		message: 'Last: {time}',
		context: 'Metadata row showing the last run time. {time} is a formatted date.',
	},
	'scheduledTasks.resetButton': { message: 'Reset', context: 'Button that re-enables a task paused due to errors.' },
	'scheduledTasks.resetting': {
		message: 'Resetting...',
		context: 'Transient button label while the reset is in progress.',
	},
	'scheduledTasks.runNowButton': { message: 'Run now', context: 'Button that immediately runs a scheduled task.' },
	'scheduledTasks.running': {
		message: 'Running...',
		context: 'Transient button label while a task run is being submitted.',
	},
	'scheduledTasks.submitted': {
		message: 'Submitted',
		context: 'Button label after a task run was successfully submitted.',
	},
	'scheduledTasks.runError': { message: 'Error', context: 'Button label when running a scheduled task failed.' },
	'updateNotice.versionInfo': {
		message: "You've been updated to version {version}",
		context: 'Line in the plugin update modal. {version} is a semver string like 4.2.0.',
	},
	'updateNotice.whatsNew': {
		message: "What's New:",
		context: 'Heading above the list of release highlights in the update modal.',
	},
	'updateNotice.genericTitle': {
		message: '🎉 Gemini Scribe updated!',
		context:
			'Heading of the update modal when no specific release notes exist. "Gemini Scribe" is the plugin name; keep it.',
	},
	'updateNotice.genericMessage': {
		message: 'Thank you for using Gemini Scribe! This update includes improvements and bug fixes.',
		context: 'Generic body of the update modal. "Gemini Scribe" is the plugin name; keep it.',
	},
	'updateNotice.getStartedButton': {
		message: 'Get started',
		context: 'Primary button that dismisses the update modal.',
	},
	'updateNotice.releaseNotesLink': {
		message: '📖 View full release notes',
		context: 'Link in the update modal that opens the GitHub release page.',
	},
	'vaultAnalysis.title': {
		message: '🔍 Analyzing vault',
		context: 'Heading of the progress modal shown while the plugin analyzes the vault to generate AGENTS.md.',
	},
	'vaultAnalysis.description': {
		message: 'Generating context for AGENTS.md...',
		context: 'Description in the vault analysis progress modal. "AGENTS.md" is a literal filename; keep it.',
	},
	'vaultAnalysis.initializing': {
		message: 'Initializing...',
		context: 'Initial status text next to the spinner in the vault analysis progress modal.',
	},
	'vaultAnalysis.complete': {
		message: 'Analysis complete!',
		context: 'Default status text when the vault analysis finishes.',
	},
	'selectionResponse.title': {
		message: 'AI response',
		context: 'Heading of the modal showing the AI answer about a text selection.',
	},
	'selectionResponse.selectedTextLabel': {
		message: 'Selected text',
		context: 'Label above the collapsed preview of the selected text in the AI response modal.',
	},
	'selectionResponse.generating': {
		message: 'Generating response...',
		context: 'Loading text shown next to a spinner while the AI response is generated.',
	},
	'selectionResponse.insertButton': {
		message: 'Insert as callout',
		context: 'Button that inserts the AI response into the note as an Obsidian callout block.',
	},
	'selectionResponse.copyButton': { message: 'Copy', context: 'Button that copies the AI response to the clipboard.' },
	'selectionResponse.closeButton': { message: 'Close', context: 'Button that closes the AI response modal.' },
	'selectionResponse.errorPrefix': {
		message: 'Error: {error}',
		context: 'Error text in the AI response modal. {error} is the raw error message.',
	},
	'selectionResponse.insertedNotice': {
		message: 'Response inserted as callout',
		context: 'Notice after the AI response was inserted into the note as a callout.',
	},
	'selectionResponse.clipboardUnavailable': {
		message: 'Clipboard not available',
		context: 'Notice when the system clipboard API is unavailable.',
	},
	'selectionResponse.copiedNotice': {
		message: 'Response copied to clipboard',
		context: 'Notice after the AI response was copied to the clipboard.',
	},
	'selectionResponse.unknownError': {
		message: 'Unknown error',
		context: 'Fallback error message when the thrown error has no message.',
	},
	'selectionResponse.copyFailed': {
		message: 'Failed to copy: {message}',
		context: 'Notice when copying the AI response to the clipboard fails. {message} is the error message.',
	},
	'selectionResponse.askTitle': {
		message: 'Ask about selection',
		context: 'Heading of the modal where the user types a question about selected text.',
	},
	'selectionResponse.askSelectedTextLabel': {
		message: 'Selected text:',
		context: 'Label above the preview of the selected text in the ask-question modal.',
	},
	'selectionResponse.questionLabel': {
		message: 'Your question:',
		context: 'Label above the question textarea in the ask-question modal.',
	},
	'selectionResponse.questionPlaceholder': {
		message: 'What would you like to know about this text?',
		context: 'Placeholder in the question textarea of the ask-question modal.',
	},
	'selectionResponse.askButton': {
		message: 'Ask',
		context: 'Submit button in the ask-question modal that sends the question to the AI.',
	},
	'ragProgress.title': {
		message: 'Indexing vault',
		context: 'Heading of the live progress modal shown while RAG vault indexing runs.',
	},
	'ragProgress.currentFileLabel': {
		message: 'Currently processing:',
		context: 'Label above the file path currently being indexed.',
	},
	'ragProgress.elapsedLabel': {
		message: 'Elapsed: ',
		context: 'Label before the elapsed-time value in the indexing progress modal. Keep the trailing space.',
	},
	'ragProgress.estimatedLabel': {
		message: 'Estimated: ',
		context: 'Label before the estimated-remaining-time value in the indexing progress modal. Keep the trailing space.',
	},
	'ragProgress.backgroundButton': {
		message: 'Run in background',
		context: 'Button that closes the indexing progress modal while indexing continues.',
	},
	'ragProgress.cancelButton': {
		message: 'Cancel',
		context: 'Warning-styled button that cancels the indexing operation.',
	},
	'ragProgress.cancelling': {
		message: 'Canceling...',
		context: 'Transient button label after the user clicks Cancel during indexing.',
	},
	'ragProgress.scanning': {
		message: 'Scanning vault...',
		context: 'Status text while the indexer is still discovering files.',
	},
	'ragProgress.filesIndexed': {
		message: '{count} files indexed',
		context: 'Stat row in the indexing progress modal. {count} is a number.',
	},
	'ragProgress.filesSkipped': {
		message: '{count} files skipped (unchanged)',
		context: 'Stat row for files skipped because they had not changed. {count} is a number.',
	},
	'ragProgress.filesFailed': {
		message: '{count} files failed',
		context: 'Stat row for files that failed to index. {count} is a number.',
	},
	'ragProgress.remaining': {
		message: '{duration} remaining',
		context: 'Estimated time remaining. {duration} is a compact duration like "2m 30s".',
	},
	'ragProgress.calculating': {
		message: 'Calculating...',
		context: 'Placeholder while the estimated remaining time cannot be computed yet.',
	},
	'ragProgress.titleFailed': {
		message: 'Indexing failed',
		context: 'Heading of the progress modal when indexing ends with an error.',
	},
	'ragProgress.titleComplete': {
		message: 'Indexing complete',
		context: 'Heading of the progress modal when indexing finishes successfully.',
	},
	'ragProgress.closeButton': {
		message: 'Close',
		context: 'Button that closes the progress modal after indexing finishes.',
	},
	'mcpServer.titleAdd': {
		message: 'Add MCP server',
		context: 'Heading of the modal when adding a new MCP server configuration. "MCP" is a protocol name; keep it.',
	},
	'mcpServer.titleEdit': {
		message: 'Edit MCP server',
		context: 'Heading of the modal when editing an existing MCP server configuration.',
	},
	'mcpServer.nameSetting': { message: 'Server name', context: 'Setting label for the MCP server name field.' },
	'mcpServer.nameDesc': {
		message: 'A unique, friendly name for this server',
		context: 'Description under the server name setting.',
	},
	'mcpServer.namePlaceholder': {
		message: 'e.g., filesystem',
		context:
			'Placeholder example in the server name field. "filesystem" is an example server name; may stay untranslated.',
	},
	'mcpServer.transportSetting': { message: 'Transport', context: 'Setting label for the MCP transport type dropdown.' },
	'mcpServer.transportDesc': {
		message: 'How to connect to the server: local process (stdio) or remote URL (HTTP)',
		context: 'Description of the transport dropdown. "stdio" and "HTTP" are technical terms; keep them.',
	},
	'mcpServer.transportStdio': { message: 'Stdio (local process)', context: 'Dropdown option for the stdio transport.' },
	'mcpServer.transportHttp': { message: 'HTTP (remote server)', context: 'Dropdown option for the HTTP transport.' },
	'mcpServer.urlSetting': { message: 'Server URL', context: 'Setting label for the HTTP endpoint of the MCP server.' },
	'mcpServer.urlDesc': {
		message: 'The HTTP endpoint of the MCP server',
		context: 'Description under the server URL setting.',
	},
	'mcpServer.urlPlaceholder': {
		message: 'e.g., http://localhost:3000/mcp',
		context: 'Placeholder example URL; keep the URL itself untranslated.',
	},
	'mcpServer.oauthSetting': {
		message: 'OAuth credentials',
		context: 'Setting label shown when the server has stored OAuth tokens.',
	},
	'mcpServer.oauthDesc': {
		message: 'Server has stored OAuth tokens',
		context: 'Description under the OAuth credentials setting.',
	},
	'mcpServer.oauthClearButton': {
		message: 'Clear credentials',
		context: 'Warning-styled button that deletes the stored OAuth tokens.',
	},
	'mcpServer.oauthClearedNotice': {
		message: 'OAuth credentials cleared. You will need to re-authorize.',
		context: 'Notice after clearing OAuth credentials.',
	},
	'mcpServer.commandSetting': {
		message: 'Command',
		context: 'Setting label for the command that spawns the MCP server process.',
	},
	'mcpServer.commandDesc': {
		message: 'The command to spawn the MCP server process',
		context: 'Description under the command setting.',
	},
	'mcpServer.commandPlaceholder': {
		message: 'e.g., npx, python, /usr/local/bin/mcp-server',
		context: 'Placeholder example commands; keep the command names untranslated.',
	},
	'mcpServer.argsSetting': { message: 'Arguments', context: 'Setting label for the command arguments textarea.' },
	'mcpServer.argsDesc': {
		message: 'Command arguments, one per line',
		context: 'Description under the arguments setting.',
	},
	'mcpServer.argsPlaceholder': {
		message: 'e.g.,\n-y\n@modelcontextprotocol/server-filesystem\n/path/to/folder',
		context:
			'Multi-line placeholder with example arguments; keep the argument values untranslated and keep the \n line breaks.',
	},
	'mcpServer.envSetting': {
		message: 'Environment variables',
		context: 'Setting label for the environment variables textarea.',
	},
	'mcpServer.envDesc': {
		message: 'Optional KEY=VALUE pairs, one per line. Values are stored in your OS keychain, not in plaintext.',
		context: 'Description under the environment variables setting. KEY=VALUE is a literal format; keep it.',
	},
	'mcpServer.envPlaceholder': {
		message: 'e.g., API_KEY=abc123',
		context: 'Placeholder example environment variable; keep API_KEY=abc123 untranslated.',
	},
	'mcpServer.enabledSetting': {
		message: 'Enabled',
		context: 'Toggle label that controls whether the plugin connects to this MCP server on load.',
	},
	'mcpServer.enabledDesc': {
		message: 'Connect to this server when the plugin loads',
		context: 'Description under the enabled toggle.',
	},
	'mcpServer.testSetting': { message: 'Test connection', context: 'Setting label for the test-connection row.' },
	'mcpServer.testDesc': {
		message: 'Connect temporarily to discover available tools',
		context: 'Description of the test-connection row.',
	},
	'mcpServer.testButton': {
		message: 'Test connection',
		context: 'Button that connects to the MCP server to verify the configuration.',
	},
	'mcpServer.urlRequiredFirst': {
		message: 'Please enter a URL first',
		context: 'Notice when testing an HTTP server without a URL filled in.',
	},
	'mcpServer.commandRequiredFirst': {
		message: 'Please enter a command first',
		context: 'Notice when testing a stdio server without a command filled in.',
	},
	'mcpServer.connecting': {
		message: 'Connecting...',
		context: 'Transient button label while the test connection is in progress.',
	},
	'mcpServer.connectingDesc': {
		message: 'Connecting to server...',
		context: 'Status text under the test-connection row while connecting.',
	},
	'mcpServer.connectedDesc': {
		message: 'Connected successfully! Found {count} tool(s).',
		context: 'Status after a successful test connection. {count} is the number of tools discovered.',
	},
	'mcpServer.connectionFailedDesc': {
		message: 'Connection failed: {message}',
		context: 'Status after a failed test connection. {message} is the raw error message.',
	},
	'mcpServer.cancelButton': { message: 'Cancel', context: 'Button that closes the MCP server modal without saving.' },
	'mcpServer.saveButton': { message: 'Save', context: 'Primary button that saves the MCP server configuration.' },
	'mcpServer.nameRequired': {
		message: 'Server name is required',
		context: 'Validation notice when saving without a server name.',
	},
	'mcpServer.urlRequired': {
		message: 'Server URL is required for HTTP transport',
		context: 'Validation notice when saving an HTTP server without a URL.',
	},
	'mcpServer.invalidUrl': {
		message: 'Invalid URL format',
		context: 'Validation notice when the server URL cannot be parsed.',
	},
	'mcpServer.commandRequired': {
		message: 'Command is required for stdio transport',
		context: 'Validation notice when saving a stdio server without a command.',
	},
	'mcpServer.envStoreFailed': {
		message: 'Failed to store environment variables',
		context: 'Notice when persisting environment variables to the OS keychain fails.',
	},
	'mcpServer.discoveredToolsTitle': {
		message: 'Discovered tools',
		context: 'Heading above the list of tools found on the MCP server.',
	},
	'mcpServer.discoveredToolsDesc': {
		message: 'These tools were discovered on the server. Manage their permissions in the tool permissions settings.',
		context: 'Description under the discovered tools heading. "Tool Permissions" is a settings section name.',
	},
	'ragStatus.title': {
		message: 'RAG index status',
		context: 'Heading of the modal showing detailed vault index status. "RAG" is a technical acronym; keep it.',
	},
	'ragStatus.tabOverview': { message: 'Overview', context: 'Tab label in the RAG status modal.' },
	'ragStatus.tabFiles': {
		message: 'Files ({count})',
		context: 'Tab label listing indexed files. {count} is a pre-formatted (locale-aware) number string.',
	},
	'ragStatus.tabFailures': {
		message: 'Failures ({count})',
		context: 'Tab label listing files that failed to index. {count} is a number.',
	},
	'ragStatus.statusLabel': { message: 'Status', context: 'Row label in the RAG status overview tab.' },
	'ragStatus.filesIndexedLabel': {
		message: 'Files indexed',
		context: 'Row label in the RAG status overview tab, followed by a count.',
	},
	'ragStatus.pendingLabel': {
		message: 'Pending',
		context: 'Row label for pending (not yet synced) changes in the RAG status overview tab.',
	},
	'ragStatus.changeSingular': {
		message: '{count} change',
		context: 'Pending-changes value, singular. {count} is always 1.',
	},
	'ragStatus.changePlural': { message: '{count} changes', context: 'Pending-changes value, plural.' },
	'ragStatus.failedLabel': { message: 'Failed', context: 'Row label for failed files in the RAG status overview tab.' },
	'ragStatus.fileSingular': { message: '{count} file', context: 'Failed-files value, singular. {count} is always 1.' },
	'ragStatus.filePlural': { message: '{count} files', context: 'Failed-files value, plural.' },
	'ragStatus.lastSyncLabel': {
		message: 'Last sync',
		context: 'Row label for the last sync time in the RAG status overview tab.',
	},
	'ragStatus.storeLabel': {
		message: 'Store',
		context: 'Row label for the cloud store name in the RAG status overview tab.',
	},
	'ragStatus.syncNowButton': {
		message: 'Sync now',
		context: 'Button in the RAG status modal that processes pending index changes immediately.',
	},
	'ragStatus.syncTooltipPending': {
		message: 'Process pending changes now',
		context: 'Tooltip of the Sync Now button when there are pending changes.',
	},
	'ragStatus.syncTooltipNone': {
		message: 'No pending changes',
		context: 'Tooltip of the disabled Sync Now button when nothing is pending.',
	},
	'ragStatus.syncing': { message: 'Syncing...', context: 'Transient button label while a sync is running.' },
	'ragStatus.syncFailed': {
		message: 'Sync failed: {message}',
		context: 'Notice when the manual sync fails. {message} is the raw error message.',
	},
	'ragStatus.reindexButton': {
		message: 'Reindex all',
		context: 'Button in the RAG status modal that rebuilds the entire index.',
	},
	'ragStatus.settingsButton': {
		message: 'Settings',
		context: 'Button in the RAG status modal that opens the plugin settings.',
	},
	'ragStatus.searchPlaceholder': {
		message: 'Search files...',
		context: 'Placeholder of the search box in the Files tab of the RAG status modal.',
	},
	'ragStatus.noFilesIndexed': {
		message: 'No files indexed yet',
		context: 'Empty state of the Files tab when nothing has been indexed.',
	},
	'ragStatus.noSearchMatches': {
		message: 'No files match your search',
		context: 'Empty state of the Files tab when the search filter matches nothing.',
	},
	'ragStatus.showAllFiles': {
		message: 'Show all {count} files',
		context: 'Button that expands the truncated file list. {count} is a pre-formatted (locale-aware) number string.',
	},
	'ragStatus.noFailures': { message: 'No failures recorded', context: 'Empty state of the Failures tab.' },
	'ragStatus.statusReady': { message: 'Ready', context: 'Index status value: idle and up to date.' },
	'ragStatus.statusIndexing': { message: 'Indexing...', context: 'Index status value: indexing in progress.' },
	'ragStatus.statusError': { message: 'Error', context: 'Index status value: last operation errored.' },
	'ragStatus.statusPaused': { message: 'Paused', context: 'Index status value: indexing paused.' },
	'ragStatus.statusDisabled': { message: 'Disabled', context: 'Index status value: RAG indexing turned off.' },
	'ragStatus.statusRateLimited': {
		message: 'Rate limited',
		context: 'Index status value: API rate limit hit; waiting.',
	},
	'ragStatus.statusUnknown': { message: 'Unknown', context: 'Index status value when the status is unrecognized.' },
	'time.justNow': { message: 'Just now', context: 'Relative timestamp for under a minute ago.' },
	'time.minuteAgoSingular': {
		message: '{count} minute ago',
		context: 'Relative timestamp, singular minute. {count} is always 1.',
	},
	'time.minutesAgoPlural': { message: '{count} minutes ago', context: 'Relative timestamp, plural minutes.' },
	'time.hourAgoSingular': {
		message: '{count} hour ago',
		context: 'Relative timestamp, singular hour. {count} is always 1.',
	},
	'time.hoursAgoPlural': { message: '{count} hours ago', context: 'Relative timestamp, plural hours.' },
	'time.dayAgoSingular': {
		message: '{count} day ago',
		context: 'Relative timestamp, singular day. {count} is always 1.',
	},
	'time.daysAgoPlural': { message: '{count} days ago', context: 'Relative timestamp, plural days.' },
	'scheduler.presetOnce': { message: 'Once', context: 'Schedule preset option: run the task a single time.' },
	'scheduler.presetDaily': { message: 'Daily (every 24h)', context: 'Schedule preset option: run every 24 hours.' },
	'scheduler.presetDailyAt': {
		message: 'Daily at time',
		context: 'Schedule preset option: run daily at a specific time of day.',
	},
	'scheduler.presetWeekly': { message: 'Weekly (every 7d)', context: 'Schedule preset option: run every 7 days.' },
	'scheduler.presetWeeklyDays': {
		message: 'Weekly on days at time',
		context: 'Schedule preset option: run on chosen weekdays at a specific time.',
	},
	'scheduler.presetCustom': {
		message: 'Custom interval',
		context: 'Schedule preset option: user provides a custom interval like 30m or 2h.',
	},
	'scheduler.daySun': { message: 'Sun', context: 'Abbreviated weekday label (Sunday) in the day picker.' },
	'scheduler.dayMon': { message: 'Mon', context: 'Abbreviated weekday label (Monday) in the day picker.' },
	'scheduler.dayTue': { message: 'Tue', context: 'Abbreviated weekday label (Tuesday) in the day picker.' },
	'scheduler.dayWed': { message: 'Wed', context: 'Abbreviated weekday label (Wednesday) in the day picker.' },
	'scheduler.dayThu': { message: 'Thu', context: 'Abbreviated weekday label (Thursday) in the day picker.' },
	'scheduler.dayFri': { message: 'Fri', context: 'Abbreviated weekday label (Friday) in the day picker.' },
	'scheduler.daySat': { message: 'Sat', context: 'Abbreviated weekday label (Saturday) in the day picker.' },
	'scheduler.entityLabel': {
		message: 'task',
		context:
			"Lowercase singular noun for a scheduled task; interpolated into shared management-modal strings like 'Delete this {label}?'.",
	},
	'scheduler.entityLabelPlural': { message: 'Scheduled tasks', context: 'Heading of the scheduler management modal.' },
	'scheduler.newTaskButton': {
		message: 'New task',
		context: 'Button in the scheduler management modal that creates a scheduled task.',
	},
	'scheduler.emptyText': {
		message: 'No scheduled tasks yet.',
		context: 'Empty state of the scheduler management modal list.',
	},
	'scheduler.emptyHint': {
		message: 'Create your first task to automate recurring AI prompts — daily summaries, weekly reports, and more.',
		context: 'Hint under the empty state of the scheduler management modal.',
	},
	'scheduler.deleteTitle': {
		message: 'Delete task',
		context: 'Heading of the delete-confirmation view for a scheduled task.',
	},
	'scheduler.deleteHint': {
		message: 'Run output files in Scheduled-Tasks/Runs/ are not deleted.',
		context: 'Hint in the delete confirmation. "Scheduled-Tasks/Runs/" is a literal folder path; keep it.',
	},
	'scheduler.slugPlaceholder': {
		message: 'e.g. daily-summary',
		context: 'Placeholder for the task name (slug) field. "daily-summary" is an example slug; may stay untranslated.',
	},
	'scheduler.formTitleEdit': {
		message: 'Edit: {slug}',
		context: 'Form heading when editing a scheduled task. {slug} is the task identifier.',
	},
	'scheduler.formTitleNew': { message: 'New scheduled task', context: 'Form heading when creating a scheduled task.' },
	'scheduler.badgeDisabled': {
		message: '{schedule} · disabled',
		context: 'Badge next to a task. {schedule} is the raw schedule string; translate only "disabled".',
	},
	'scheduler.badgePaused': {
		message: '{schedule} · paused',
		context:
			'Badge next to a task paused due to errors. {schedule} is the raw schedule string; translate only "paused".',
	},
	'scheduler.onceComplete': {
		message: 'Once — complete',
		context: 'Shown instead of the next-run time for one-time tasks that already ran.',
	},
	'scheduler.nextRun': {
		message: 'Next: {time}',
		context: 'Metadata row showing the next scheduled run. {time} is a formatted date or "Once — complete".',
	},
	'scheduler.lastRun': {
		message: 'Last: {time}',
		context: 'Metadata row showing the last run time. {time} is a formatted date.',
	},
	'scheduler.enableButton': { message: 'Enable', context: 'Per-row button that enables a disabled scheduled task.' },
	'scheduler.disableButton': { message: 'Disable', context: 'Per-row button that disables a scheduled task.' },
	'scheduler.enableTooltip': { message: 'Enable this task', context: 'Tooltip of the Enable button.' },
	'scheduler.disableTooltip': { message: 'Disable this task', context: 'Tooltip of the Disable button.' },
	'scheduler.toggleFailed': {
		message: 'Failed to toggle "{slug}"',
		context: 'Notice when enabling/disabling a task fails. {slug} is the task identifier.',
	},
	'scheduler.resetButton': {
		message: 'Reset',
		context: 'Button that clears the error state of a paused task and re-enables it.',
	},
	'scheduler.resetTooltip': { message: 'Clear error state and re-enable', context: 'Tooltip of the Reset button.' },
	'scheduler.runNowButton': { message: 'Run now', context: 'Button that immediately runs a scheduled task.' },
	'scheduler.running': {
		message: 'Running...',
		context: 'Transient button label while a task run is being submitted.',
	},
	'scheduler.submitted': { message: 'Submitted', context: 'Button label after a task run was successfully submitted.' },
	'scheduler.runFailed': {
		message: 'Failed to run "{slug}"',
		context: 'Notice when running a task fails. {slug} is the task identifier.',
	},
	'scheduler.editButton': { message: 'Edit', context: 'Per-row button that opens the edit form for a scheduled task.' },
	'scheduler.deleteButton': {
		message: 'Delete',
		context: 'Per-row button that opens the delete confirmation for a scheduled task.',
	},
	'scheduler.scheduleSetting': { message: 'Schedule', context: 'Form label for the schedule preset selector.' },
	'scheduler.scheduleDesc': {
		message: 'How often the task should run.',
		context: 'Description under the schedule selector.',
	},
	'scheduler.customIntervalPlaceholder': {
		message: 'e.g. 30m or 2h',
		context: 'Placeholder for the custom interval input. "30m"/"2h" are literal interval formats; keep them.',
	},
	'scheduler.toolAccessTitle': {
		message: 'Tool access',
		context: 'Title of the tool policy editor section in the task form.',
	},
	'scheduler.toolAccessDesc': {
		message: "When inherited, this task uses the plugin's global tool policy.",
		context: 'Description of the tool policy editor section.',
	},
	'scheduler.promptSetting': { message: 'Prompt', context: 'Form label for the task prompt textarea.' },
	'scheduler.promptDesc': {
		message: 'The instruction sent to the AI on each run. Supports the same markdown you would use in the agent chat.',
		context: 'Description under the prompt setting.',
	},
	'scheduler.promptPlaceholder': {
		message: 'Write your prompt here...',
		context: 'Placeholder of the prompt textarea.',
	},
	'scheduler.advancedOptions': {
		message: 'Advanced options',
		context: 'Summary label of the collapsible advanced section in the task form.',
	},
	'scheduler.modelOverrideSetting': {
		message: 'Model override',
		context: 'Form label for the per-task model override field.',
	},
	'scheduler.modelOverrideDesc': {
		message: 'Override the plugin chat model for this task (e.g. gemini-2.0-flash). Leave blank to use the default.',
		context: 'Description of the model override field. "gemini-2.0-flash" is a literal model id; keep it.',
	},
	'scheduler.outputPathSetting': { message: 'Output path', context: 'Form label for the run output path field.' },
	'scheduler.outputPathDesc': {
		message: 'Where to write results. Supports {slug} and {date} placeholders. Default: {defaultPath}',
		context:
			'Description of the output path field. "{slug}" and "{date}" are literal template tokens the user can type — keep them verbatim. {defaultPath} is the computed default path.',
	},
	'scheduler.maxIterationsSetting': {
		message: 'Max tool iterations',
		context: 'Form label for the per-task tool iteration cap.',
	},
	'scheduler.maxIterationsDesc': {
		message:
			'Cap on agent tool-call batches per run. Raise this for long multi-step tasks that hit the limit. Leave blank for the default ({default}).',
		context: 'Description of the max iterations field. {default} is the numeric default.',
	},
	'scheduler.runIfMissedSetting': {
		message: 'Run if missed',
		context: 'Toggle label: queue the task for catch-up approval if its run was missed.',
	},
	'scheduler.runIfMissedDesc': {
		message: 'When Obsidian was closed and this task was due, show it in the catch-up approval modal on next startup.',
		context: 'Description of the run-if-missed toggle.',
	},
	'scheduler.enabledSetting': { message: 'Enabled', context: 'Toggle label that enables/disables the scheduled task.' },
	'scheduler.enabledDesc': {
		message: 'Disable to pause the task without deleting it.',
		context: 'Description of the enabled toggle.',
	},
	'scheduler.invalidSchedule': {
		message:
			'Please enter a valid schedule. Custom interval expects 30m or 2h. Daily at time and Weekly on days at time both need a valid HH:MM (and Weekly needs at least one day).',
		context: 'Validation notice for an invalid schedule. "30m", "2h", and "HH:MM" are literal formats; keep them.',
	},
	'scheduler.emptyPrompt': {
		message: 'Prompt cannot be empty.',
		context: 'Validation notice when saving a task without a prompt.',
	},
	'scheduler.emptySlug': {
		message: 'Task name cannot be empty.',
		context: 'Validation notice when creating a task without a name.',
	},
	'scheduler.invalidMaxIterations': {
		message: 'Max tool iterations must be a positive whole number, or blank for the default.',
		context: 'Validation notice for an invalid max-iterations value.',
	},
	'scheduler.managerUnavailable': {
		message: 'Scheduled task manager not available.',
		context: 'Notice when the scheduler service is not running while saving a task.',
	},
	'scheduler.taskUpdated': {
		message: 'Task "{slug}" updated',
		context: 'Notice after a scheduled task was updated. {slug} is the task identifier.',
	},
	'scheduler.taskCreated': {
		message: 'Task "{slug}" created',
		context: 'Notice after a scheduled task was created. {slug} is the task identifier.',
	},
	'scheduler.saveFailed': {
		message: 'Failed to save task: {message}',
		context: 'Notice when saving a task fails. {message} is the raw error message.',
	},
	'hooks.triggerFileModified': {
		message: 'File modified (save)',
		context: 'Dropdown option for the hook trigger: fires when a file is saved.',
	},
	'hooks.triggerFileCreated': {
		message: 'File created',
		context: 'Dropdown option for the hook trigger: fires when a new file appears.',
	},
	'hooks.triggerFileDeleted': {
		message: 'File deleted',
		context: 'Dropdown option for the hook trigger: fires after a file is removed.',
	},
	'hooks.triggerFileRenamed': {
		message: 'File renamed/moved',
		context: 'Dropdown option for the hook trigger: fires when a path changes.',
	},
	'hooks.actionAgentTask': {
		message: 'Agent task',
		context: 'Dropdown option for the hook action: run a headless agent session.',
	},
	'hooks.actionSummarize': {
		message: 'Summarize file',
		context: 'Dropdown option for the hook action: summarize the triggering file.',
	},
	'hooks.actionRewrite': {
		message: 'Rewrite file',
		context: 'Dropdown option for the hook action: rewrite the triggering file using the prompt.',
	},
	'hooks.actionCommand': {
		message: 'Run command',
		context: 'Dropdown option for the hook action: execute a command palette command.',
	},
	'hooks.entityLabel': {
		message: 'hook',
		context:
			"Lowercase singular noun for a lifecycle hook; interpolated into shared management-modal strings like 'Delete this {label}?'.",
	},
	'hooks.entityLabelPlural': { message: 'Lifecycle hooks', context: 'Heading of the hook management modal.' },
	'hooks.newHookButton': {
		message: 'New hook',
		context: 'Button in the hook management modal that creates a lifecycle hook.',
	},
	'hooks.emptyText': { message: 'No hooks yet.', context: 'Empty state of the hook management modal list.' },
	'hooks.emptyHint': {
		message:
			'Hooks run an AI agent in response to vault events — file saves, creates, deletes, renames. Create your first hook to summarize on save, index new attachments, or run a skill on certain notes.',
		context: 'Hint under the empty state of the hook management modal.',
	},
	'hooks.deleteTitle': {
		message: 'Delete hook',
		context: 'Heading of the delete-confirmation view for a lifecycle hook.',
	},
	'hooks.deleteHint': {
		message: 'Output files in Hooks/Runs/ are not deleted.',
		context: 'Hint in the delete confirmation. "Hooks/Runs/" is a literal folder path; keep it.',
	},
	'hooks.slugPlaceholder': {
		message: 'e.g. summarize-on-save',
		context:
			'Placeholder for the hook name (slug) field. "summarize-on-save" is an example slug; may stay untranslated.',
	},
	'hooks.formTitleEdit': {
		message: 'Edit hook: {slug}',
		context: 'Form heading when editing a hook. {slug} is the hook identifier.',
	},
	'hooks.formTitleNew': { message: 'New hook', context: 'Form heading when creating a hook.' },
	'hooks.disabledBannerTitle': {
		message: 'Lifecycle hooks are disabled.',
		context: 'Banner in the hook management modal when the hooks feature is off in settings.',
	},
	'hooks.disabledBannerHint': {
		message:
			'Enable "Lifecycle hooks" in plugin settings before any hook can fire. You can still create definitions here while disabled — they will not run until you turn the feature on.',
		context: 'Hint under the disabled banner. "Lifecycle hooks" is the settings toggle name.',
	},
	'hooks.badgeDisabled': {
		message: '{badge} · disabled',
		context: 'Badge next to a disabled hook. {badge} is a "trigger → action" summary; translate only "disabled".',
	},
	'hooks.badgePaused': {
		message: '{badge} · paused',
		context:
			'Badge next to a hook paused due to repeated errors. {badge} is a "trigger → action" summary; translate only "paused".',
	},
	'hooks.globMeta': {
		message: 'Glob: {glob}',
		context: 'Metadata row showing the path glob filter. {glob} is a literal glob pattern.',
	},
	'hooks.lastFired': {
		message: 'Last fired: {time}',
		context: 'Metadata row showing when the hook last fired. {time} is a formatted date.',
	},
	'hooks.enableButton': { message: 'Enable', context: 'Per-row button that enables a disabled hook.' },
	'hooks.disableButton': { message: 'Disable', context: 'Per-row button that disables a hook.' },
	'hooks.toggleFailed': {
		message: 'Failed to toggle "{slug}"',
		context: 'Notice when enabling/disabling a hook fails. {slug} is the hook identifier.',
	},
	'hooks.resetButton': { message: 'Reset', context: 'Button that clears the paused-due-to-errors state of a hook.' },
	'hooks.resetTooltip': { message: 'Clear pause state', context: 'Tooltip of the hook Reset button.' },
	'hooks.editButton': { message: 'Edit', context: 'Per-row button that opens the edit form for a hook.' },
	'hooks.deleteButton': { message: 'Delete', context: 'Per-row button that opens the delete confirmation for a hook.' },
	'hooks.triggerSetting': { message: 'Trigger', context: 'Form label for the hook trigger dropdown.' },
	'hooks.triggerDesc': {
		message: 'The vault event that fires this hook.',
		context: 'Description under the trigger dropdown.',
	},
	'hooks.actionSetting': { message: 'Action', context: 'Form label for the hook action dropdown.' },
	'hooks.actionDesc': {
		message: 'What this hook does on each fire.',
		context: 'Description under the action dropdown.',
	},
	'hooks.pathGlobSetting': { message: 'Path glob (optional)', context: 'Form label for the path glob filter field.' },
	'hooks.pathGlobDesc': {
		message: 'Limit fires to paths matching this glob. Examples: Daily/**/*.md, Notes/*.md. Leave blank for any path.',
		context: 'Description of the path glob field. The glob patterns are literal examples; keep them.',
	},
	'hooks.commandIdSetting': {
		message: 'Command id',
		context: 'Form label for the command palette id field (command action only).',
	},
	'hooks.commandIdDesc': {
		message:
			'Command palette id to fire. Examples: editor:save-file, gemini-scribe-summarize-active-file. View command IDs via Settings → Hotkeys (open the developer console with Ctrl+Shift+I to inspect ids).',
		context: 'Description of the command id field. The example ids and Ctrl+Shift+I are literal; keep them.',
	},
	'hooks.focusFileSetting': {
		message: 'Focus trigger file before dispatch',
		context: 'Toggle label: open the triggering file before running the command.',
	},
	'hooks.focusFileDesc': {
		message:
			'When on, the triggering file is opened in the workspace before the command runs — useful for editor-scoped commands. When off, the command runs against whatever file is currently active. Default off.',
		context: 'Description of the focus-file toggle.',
	},
	'hooks.toolAccessTitle': {
		message: 'Tool access',
		context: 'Title of the tool policy editor section in the hook form.',
	},
	'hooks.toolAccessDesc': {
		message: "When inherited, this hook uses the plugin's global tool policy.",
		context: 'Description of the tool policy editor section in the hook form.',
	},
	'hooks.promptSetting': { message: 'Prompt', context: 'Form label for the hook prompt textarea.' },
	'hooks.promptDesc': {
		message:
			'Instruction sent to the AI on each fire. Available variables: {{filePath}}, {{fileName}}, {{trigger}}, {{oldPath}}.',
		context:
			'Description of the prompt field. The double-brace variables are literal template tokens; keep them verbatim.',
	},
	'hooks.promptPlaceholder': {
		message: 'e.g. Summarize the changes in {{filePath}}.',
		context: 'Placeholder of the hook prompt textarea. {{filePath}} is a literal template token; keep it verbatim.',
	},
	'hooks.advancedOptions': {
		message: 'Advanced options',
		context: 'Summary label of the collapsible advanced section in the hook form.',
	},
	'hooks.debounceSetting': { message: 'Debounce (ms)', context: 'Form label for the debounce-in-milliseconds field.' },
	'hooks.debounceDesc': {
		message: 'Coalesce rapid events for the same file. Default {default}.',
		context: 'Description of the debounce field. {default} is the default value in milliseconds.',
	},
	'hooks.cooldownSetting': { message: 'Cooldown (ms)', context: 'Form label for the cooldown-in-milliseconds field.' },
	'hooks.cooldownDesc': {
		message:
			'After a fire completes, suppress further events on the same (hook, file) for this window. Default {default}.',
		context: 'Description of the cooldown field. {default} is the default value in milliseconds.',
	},
	'hooks.maxRunsSetting': { message: 'Max runs per hour', context: 'Form label for the hourly run cap field.' },
	'hooks.maxRunsDesc': {
		message: 'Sliding-window cap across all files. 0 (default) means unlimited.',
		context: 'Description of the max-runs-per-hour field.',
	},
	'hooks.skillsSetting': {
		message: 'Skills (comma-separated)',
		context: 'Form label for the pre-activated skills field.',
	},
	'hooks.skillsDesc': {
		message: 'Slugs of skills to pre-activate. Empty = inherit all available skills.',
		context: 'Description of the skills field.',
	},
	'hooks.modelOverrideSetting': {
		message: 'Model override',
		context: 'Form label for the per-hook model override field.',
	},
	'hooks.modelOverrideDesc': {
		message: 'Override the plugin chat model for this hook. Leave blank to use the default.',
		context: 'Description of the model override field.',
	},
	'hooks.maxIterationsSetting': {
		message: 'Max tool iterations',
		context: 'Form label for the per-hook tool iteration cap.',
	},
	'hooks.maxIterationsDesc': {
		message:
			'Cap on agent tool-call batches per fire (agent-task only). Raise it for long multi-step hooks that hit the limit. Leave blank for the default ({default}).',
		context:
			'Description of the max iterations field. {default} is the numeric default; "agent-task" is an action name.',
	},
	'hooks.outputPathSetting': {
		message: 'Output path (optional)',
		context: 'Form label for the run output path field.',
	},
	'hooks.outputPathDesc': {
		message:
			'Where to write the agent response. Supports {slug}, {date}, {fileName}. Leave blank to skip writing a file.',
		context:
			'Description of the output path field. "{slug}", "{date}", "{fileName}" are literal template tokens the user can type — keep them verbatim.',
	},
	'hooks.desktopOnlySetting': { message: 'Desktop only', context: 'Toggle label: skip the hook on mobile platforms.' },
	'hooks.desktopOnlyDesc': {
		message: 'Skip this hook on mobile platforms. Headless agent runs can be heavy on phones.',
		context: 'Description of the desktop-only toggle.',
	},
	'hooks.enabledSetting': { message: 'Enabled', context: 'Toggle label that enables/disables the hook.' },
	'hooks.enabledDesc': {
		message: 'Disable to pause the hook without deleting it.',
		context: 'Description of the enabled toggle.',
	},
	'hooks.emptyPrompt': {
		message: 'Prompt cannot be empty for this action.',
		context: 'Validation notice when saving an agent-task or rewrite hook without a prompt.',
	},
	'hooks.emptyCommandId': {
		message: 'Command id cannot be empty for the "command" action.',
		context: 'Validation notice when saving a command hook without a command id.',
	},
	'hooks.emptySlug': {
		message: 'Hook name cannot be empty.',
		context: 'Validation notice when creating a hook without a name.',
	},
	'hooks.invalidMaxIterations': {
		message: 'Max tool iterations must be a positive whole number, or blank for the default.',
		context: 'Validation notice for an invalid max-iterations value in the hook form.',
	},
	'hooks.managerUnavailable': {
		message: 'Hook manager not available.',
		context: 'Notice when the hook service is not running while saving.',
	},
	'hooks.hookUpdated': {
		message: 'Hook "{slug}" updated',
		context: 'Notice after a hook was updated. {slug} is the hook identifier.',
	},
	'hooks.hookCreated': {
		message: 'Hook "{slug}" created',
		context: 'Notice after a hook was created. {slug} is the hook identifier.',
	},
	'hooks.saveFailed': {
		message: 'Failed to save hook: {message}',
		context: 'Notice when saving a hook fails. {message} is the raw error message.',
	},
	'backgroundTasks.tabTasks': {
		message: 'Background tasks',
		context: 'Top-level tab label in the Gemini Activity modal listing background tasks.',
	},
	'backgroundTasks.tabRag': {
		message: 'RAG',
		context:
			'Top-level tab label in the Gemini Activity modal for vault indexing. "RAG" is a technical acronym; keep it.',
	},
	'backgroundTasks.managerUnavailable': {
		message: 'Background task manager not available.',
		context: 'Error text in the Background Tasks tab when the task service is not running.',
	},
	'backgroundTasks.empty': {
		message:
			'No background tasks yet. Long-running operations like deep research and image generation will appear here.',
		context: 'Empty state of the Background Tasks tab.',
	},
	'backgroundTasks.runningHeader': {
		message: 'Running',
		context: 'Section heading for currently running background tasks.',
	},
	'backgroundTasks.runningHeaderCount': {
		message: 'Running ({count})',
		context: 'Section heading for running tasks when more than 10 are active. {count} is the total.',
	},
	'backgroundTasks.moreRunning': {
		message: '+ {count} more running tasks',
		context:
			'Overflow line under the running list when more than 10 tasks are active. {count} is the number not shown.',
	},
	'backgroundTasks.recentHeader': {
		message: 'Recent',
		context: 'Section heading for recently finished background tasks.',
	},
	'backgroundTasks.clearButton': {
		message: 'Clear',
		context: 'Button that removes finished tasks from the Recent list.',
	},
	'backgroundTasks.openResult': {
		message: 'Open result',
		context: 'Link on a completed task that opens its output note.',
	},
	'backgroundTasks.cancelButton': { message: 'Cancel', context: 'Button that cancels a running background task.' },
	'backgroundTasks.durationSeconds': {
		message: '{count}s',
		context: 'Compact task duration in seconds. Keep it short.',
	},
	'backgroundTasks.durationMinutes': {
		message: '{count}m',
		context: 'Compact task duration in minutes. Keep it short.',
	},
	'backgroundTasks.startedWithDuration': {
		message: 'Started {time} · {duration}',
		context:
			'Task metadata line for a finished task. {time} is a clock time; {duration} is a compact duration like "45s".',
	},
	'backgroundTasks.started': {
		message: 'Started {time}',
		context: 'Task metadata line for a running task. {time} is a clock time.',
	},
	'backgroundTasks.ragDisabled': {
		message: 'RAG indexing is not enabled. Enable it in Settings → Gemini Scribe.',
		context: 'Empty state of the RAG tab when indexing is disabled. "Gemini Scribe" is the plugin name; keep it.',
	},
	'backgroundTasks.openFileAria': {
		message: 'Open {path}',
		context: 'Accessibility label of a file row that opens the note. {path} is a vault file path.',
	},
	'backgroundTasks.indexingComplete': {
		message: 'RAG indexing complete: {indexed} indexed, {skipped} unchanged',
		context: 'Notice when a full reindex finishes. {indexed} and {skipped} are counts.',
	},
	'backgroundTasks.indexingFailed': {
		message: 'RAG indexing failed: {message}',
		context: 'Notice when a full reindex fails. {message} is the raw error message.',
	},
	'ragProgress.durationHours': {
		message: '{hours}h {minutes}m {seconds}s',
		context: 'Compact duration with hours in the indexing progress modal. Keep it short.',
	},
	'ragProgress.durationMinutes': {
		message: '{minutes}m {seconds}s',
		context: 'Compact duration with minutes in the indexing progress modal. Keep it short.',
	},
	'ragProgress.durationSeconds': {
		message: '{seconds}s',
		context: 'Compact duration in seconds in the indexing progress modal. Keep it short.',
	},

	// --- agent ---
	'agent.view.displayName': {
		message: 'Agent mode',
		context: 'Tab/view title of the agent chat panel. "Agent Mode" is a feature name.',
	},
	'agent.view.noSkills': {
		message: 'No skills available',
		context: 'Notice shown when the user opens the skill picker but no agent skills are installed.',
	},
	'agent.view.noActiveSession': {
		message: 'No active session',
		context: 'Notice shown when an action requires an active chat session but none exists.',
	},
	'agent.tokens.usage': {
		message: 'Tokens: ~{used} / {limit} ({percent}%)',
		context:
			'Token usage indicator above the chat input. {used} and {limit} are formatted numbers, {percent} is the percentage of the context window used. Keep the ~ to indicate an approximation.',
	},
	'agent.tokens.usageCached': {
		message: 'Tokens: ~{used} / {limit} ({percent}%) · {cached}% cached',
		context:
			'Token usage indicator variant when part of the prompt was served from cache. {cached} is the cached percentage. Keep the middle-dot separator.',
	},
	'agent.empty.example.findTagged': {
		message: 'Find all notes tagged with #important',
		context:
			'Clickable example prompt in the empty chat state; clicking sends it to the AI. Keep the #important tag literal.',
	},
	'agent.empty.example.weeklySummary': {
		message: 'Create a weekly summary of my meeting notes',
		context: 'Clickable example prompt in the empty chat state; clicking sends it to the AI.',
	},
	'agent.empty.example.research': {
		message: 'Research productivity methods and create notes',
		context: 'Clickable example prompt in the empty chat state; clicking sends it to the AI.',
	},
	'agent.empty.example.organize': {
		message: 'Organize my research notes by topic',
		context: 'Clickable example prompt in the empty chat state; clicking sends it to the AI.',
	},
	'agent.message.roleUser': { message: 'You', context: 'Speaker label above a chat message written by the user.' },
	'agent.message.roleSystem': { message: 'System', context: 'Speaker label above a system-generated chat message.' },
	'agent.message.roleAgent': { message: 'Agent', context: 'Speaker label above a chat message from the AI agent.' },
	'agent.message.toolPrefix': {
		message: 'Tool: {name}',
		context:
			'Header of a collapsible tool-execution block in legacy chat history. {name} is the tool name and stays untranslated.',
	},
	'agent.message.toolSuccess': {
		message: 'Success',
		context: 'Status badge on a tool-execution block indicating the tool ran successfully.',
	},
	'agent.message.toolFailed': {
		message: 'Failed',
		context: 'Status badge on a tool-execution block indicating the tool failed.',
	},
	'agent.message.copied': {
		message: 'Message copied to clipboard.',
		context: 'Notice after the user clicks the copy button on a chat message.',
	},
	'agent.message.copyFailed': {
		message: 'Could not copy message to clipboard. Try selecting and copying manually.',
		context: 'Error notice when copying a chat message to the clipboard fails.',
	},
	'agent.message.reasoning': {
		message: 'Reasoning',
		context: 'Label of the collapsible row showing the AI model\'s internal reasoning ("thinking").',
	},
	'agent.confirm.title': {
		message: 'Permission required',
		context: 'Header of an in-chat card asking the user to approve a tool the AI wants to run.',
	},
	'agent.confirm.parameters': {
		message: 'Parameters:',
		context:
			'Label above the list of parameters the tool will be called with, on the permission card. Keep the trailing colon.',
	},
	'agent.confirm.allow': {
		message: 'Allow',
		context: 'Button on the permission card that approves the tool execution.',
	},
	'agent.confirm.cancel': {
		message: 'Cancel',
		context: 'Button on the permission card that denies the tool execution.',
	},
	'agent.confirm.dontAskAgain': {
		message: "Don't ask again this session",
		context: 'Checkbox label on the permission card; checking it auto-approves this tool for the rest of the session.',
	},
	'agent.confirm.previewFile': {
		message: 'Preview file',
		context: 'Button on the permission card that opens a preview of a new file the AI wants to create.',
	},
	'agent.confirm.viewChanges': {
		message: 'View changes',
		context: 'Button on the permission card that opens a diff of the changes the AI wants to make to an existing file.',
	},
	'agent.confirm.granted': {
		message: 'Permission granted: {name} was allowed',
		context: 'In-chat result text after the user approves a tool. {name} is the tool display name.',
	},
	'agent.confirm.denied': {
		message: 'Permission denied: {name} was canceled',
		context: 'In-chat result text after the user denies a tool. {name} is the tool display name.',
	},
	'agent.toolCategory.readOnly': {
		message: 'Read only',
		context: 'Tool category badge on the permission card: the tool only reads data.',
	},
	'agent.toolCategory.vaultOperations': {
		message: 'Vault operation',
		context:
			'Tool category badge on the permission card: the tool modifies vault files. "Vault" is the Obsidian term for a notes folder.',
	},
	'agent.toolCategory.external': {
		message: 'External',
		context: 'Tool category badge on the permission card: the tool reaches outside the vault.',
	},
	'agent.toolCategory.web': {
		message: 'Web access',
		context: 'Tool category badge on the permission card: the tool accesses the internet.',
	},
	'agent.toolCategory.memory': {
		message: 'Memory',
		context: "Tool category badge on the permission card: the tool manages the agent's long-term memory.",
	},
	'agent.toolCategory.deepResearch': {
		message: 'Deep Research',
		context: 'Tool category badge on the permission card. "Deep Research" is a feature name.',
	},
	'agent.header.loading': {
		message: 'Loading...',
		context: 'Placeholder text in the project badge in the session header while the project name loads.',
	},
	'agent.header.loadingProjectTooltip': {
		message: 'Loading project...',
		context: 'Tooltip on the project badge while the project name loads.',
	},
	'agent.header.tooltipModel': {
		message: 'Model: {value}',
		context: 'Line in the session-settings badge tooltip. {value} is a model name (untranslated).',
	},
	'agent.header.tooltipTemperature': {
		message: 'Temperature: {value}',
		context:
			'Line in the session-settings badge tooltip. "Temperature" is the AI sampling parameter; {value} is a number.',
	},
	'agent.header.tooltipTopP': {
		message: 'Top-P: {value}',
		context:
			'Line in the session-settings badge tooltip. "Top-P" is the nucleus-sampling parameter; {value} is a number.',
	},
	'agent.header.tooltipPrompt': {
		message: 'Prompt: {value}',
		context: 'Line in the session-settings badge tooltip. {value} is the name of a custom prompt template.',
	},
	'agent.header.menuAria': {
		message: 'Session menu',
		context: 'Accessibility label (aria-label) for the hamburger menu button in the session header.',
	},
	'agent.header.projectTooltip': {
		message: 'Project: {name}\n{path}',
		context:
			'Tooltip on the project badge. {name} is the project name, {path} its file path. Keep the newline between them.',
	},
	'agent.header.linkProjectTooltip': {
		message: 'Click to link a project',
		context: 'Tooltip on the project badge when no project could be loaded; clicking opens the project picker.',
	},
	'agent.project.none': {
		message: 'No project',
		context:
			'Label meaning the session is not linked to any project. Used in the header badge, the project picker, and the session-list filter dropdown.',
	},
	'agent.menu.newSession': {
		message: 'New session',
		context: 'Menu item / button that starts a new agent chat session.',
	},
	'agent.menu.browseSessions': {
		message: 'Browse sessions',
		context: 'Menu item that opens the list of saved agent sessions.',
	},
	'agent.menu.switchProject': {
		message: 'Switch project',
		context: 'Menu item that opens the project picker to change the project linked to this session.',
	},
	'agent.menu.linkProject': {
		message: 'Link project',
		context: 'Menu item that opens the project picker when no project is linked yet.',
	},
	'agent.menu.sessionSettings': {
		message: 'Session settings',
		context: "Menu item that opens the per-session settings modal. Also used as that modal's heading.",
	},
	'agent.input.placeholder': {
		message: 'Message the agent... (@ files, / skills)',
		context:
			'Placeholder text in the agent chat input box. @ and / are literal trigger characters for mentioning files and skills — keep them.',
	},
	'agent.input.sendAria': {
		message: 'Send message to agent',
		context: 'Accessibility label (aria-label) for the send button next to the chat input.',
	},
	'agent.input.stopAria': {
		message: 'Stop agent execution',
		context:
			'Accessibility label (aria-label) for the send button while it acts as a stop button during agent execution.',
	},
	'agent.input.pasteFailed': {
		message: 'Unable to paste in popout window. Try pasting in the main window.',
		context: 'Notice when pasting into the chat input fails in a popout (secondary) window.',
	},
	'agent.attachments.droppedExcluded': {
		message: 'Dropped files were excluded (system or plugin files)',
		context:
			'Notice when all files dropped onto the chat input were filtered out because they are system or plugin files.',
	},
	'agent.attachments.attachFailed': {
		message: 'Failed to attach {name}',
		context: 'Notice when attaching a file fails. {name} is the file name.',
	},
	'agent.attachments.textFileAddedOne': {
		message: '1 text file added to context',
		context: 'Part of a notice after dropping files: exactly one text file was added as conversation context.',
	},
	'agent.attachments.textFilesAdded': {
		message: '{count} text files added to context',
		context:
			'Part of a notice after dropping files: {count} (2 or more) text files were added as conversation context.',
	},
	'agent.attachments.fileAttachedOne': {
		message: '1 file attached',
		context: 'Part of a notice after dropping files: exactly one binary file (image/audio/video/PDF) was attached.',
	},
	'agent.attachments.filesAttached': {
		message: '{count} files attached',
		context: 'Part of a notice after dropping files: {count} (2 or more) binary files were attached.',
	},
	'agent.attachments.skippedSizeOne': {
		message: 'Skipped 1 file (exceeds 20MB cumulative limit): {files}',
		context:
			'Notice when one dropped file was skipped because the 20 MB total attachment limit would be exceeded. {files} is the file name.',
	},
	'agent.attachments.skippedSize': {
		message: 'Skipped {count} files (exceeds 20MB cumulative limit): {files}',
		context:
			'Notice when several dropped files were skipped due to the 20 MB total attachment limit. {files} is a comma-separated list of file names.',
	},
	'agent.attachments.skippedUnsupportedOne': {
		message: 'Skipped unsupported file type: {exts}',
		context: 'Notice when dropped files of one unsupported type were skipped. {exts} is a file extension like ".zip".',
	},
	'agent.attachments.skippedUnsupported': {
		message: 'Skipped unsupported file types: {exts}',
		context:
			'Notice when dropped files of several unsupported types were skipped. {exts} is a comma-separated list of extensions.',
	},
	'agent.attachments.unsupportedImageFormat': {
		message: 'Unsupported image format. Please use PNG, JPEG, GIF, or WebP.',
		context: 'Notice when a dropped or pasted image is in a format the AI does not accept. Keep the format names.',
	},
	'agent.attachments.sizeLimitReached': {
		message: 'Attachment size limit (20 MB) reached. Some images were skipped.',
		context: 'Notice when pasting/dropping images would exceed the 20 MB total attachment limit.',
	},
	'agent.attachments.imageAttachFailed': {
		message: 'Failed to attach image',
		context: 'Notice when reading a dropped or pasted image fails.',
	},
	'agent.attachments.imageAttachedOne': {
		message: 'Image attached',
		context: 'Notice after exactly one image was attached via drop or paste.',
	},
	'agent.attachments.imagesAttached': {
		message: '{count} images attached',
		context: 'Notice after {count} (2 or more) images were attached via drop or paste.',
	},
	'agent.attachments.imagesSkippedUnsupportedHint': {
		message: '{count} image(s) skipped: unsupported format. Use PNG, JPEG, GIF, or WebP.',
		context:
			'Notice when dropped images were skipped due to unsupported format. {count} may be 1 or more. Keep the format names.',
	},
	'agent.attachments.imagesSkippedUnsupported': {
		message: '{count} image(s) skipped: unsupported format.',
		context: 'Notice when pasted images were skipped due to unsupported format. {count} may be 1 or more.',
	},
	'agent.attachments.saveFailedOne': {
		message: "Failed to save attachment #{nums} to vault. It will still be sent to the AI but won't be stored locally.",
		context: 'Notice when saving one attachment to the vault fails. {nums} is the attachment number in the message.',
	},
	'agent.attachments.saveFailed': {
		message:
			"Failed to save attachments #{nums} to vault. They will still be sent to the AI but won't be stored locally.",
		context:
			'Notice when saving several attachments to the vault fails. {nums} is a comma-separated list of attachment numbers.',
	},
	'agent.attachments.fileTooLarge': {
		message: 'File too large: {name} exceeds 20MB cumulative attachment limit',
		context:
			'Notice when a file picked via @-mention would exceed the 20 MB total attachment limit. {name} is the file name.',
	},
	'agent.attachments.attached': {
		message: 'Attached {name}',
		context: 'Notice after a binary file picked via @-mention was attached. {name} is the file name.',
	},
	'agent.progress.thinking': {
		message: 'Thinking...',
		context: 'Progress-bar status while the AI model is processing a request.',
	},
	'agent.progress.thinkingWithBudget': {
		message: '{thinking} ({remaining} remaining)',
		context:
			'Progress-bar status while the AI model is processing, shown when the agent is running low on its turn budget. {thinking} is the localized "Thinking..." label; {remaining} is the number of tool-execution turns remaining. Plural-neutral wording ("remaining") so it reads correctly for a count of 1.',
	},
	'agent.progress.generating': {
		message: 'Generating response...',
		context: 'Progress-bar status while the AI response is streaming in.',
	},
	'agent.progress.processing': {
		message: 'Processing response...',
		context: 'Progress-bar status while a non-streaming AI response is being handled.',
	},
	'agent.progress.elapsedAria': {
		message: 'Elapsed time',
		context: 'Accessibility label (aria-label) for the elapsed-time counter in the progress bar.',
	},
	'agent.send.emptyResponse': {
		message: 'Model returned an empty response. This might happen with thinking models. Try rephrasing your question.',
		context:
			'Notice when the AI model returns no text. "Thinking models" are models that reason internally before answering.',
	},
	'agent.send.cancelled': {
		message: 'Agent execution canceled',
		context: 'Notice after the user clicks the stop button to cancel the running agent.',
	},
	'agent.planMode.toggleAria': {
		message: 'Toggle Plan Mode',
		context:
			'Aria label for the Plan Mode toggle button in the agent input bar. Plan Mode makes the agent produce a plan instead of immediately executing actions.',
	},
	'agent.planMode.activeTooltip': {
		message: 'Plan Mode ON — agent will plan before acting',
		context:
			'Tooltip shown on the Plan Mode toggle button when Plan Mode is active. Reassures the user the agent will ask for approval before doing anything.',
	},
	'agent.planMode.approve': {
		message: 'Approve & Execute',
		context: 'Button label to approve a generated plan and begin execution.',
	},
	'agent.planMode.reject': {
		message: 'Reject',
		context: 'Button label to reject a generated plan without executing it.',
	},
	'agent.planMode.approved': {
		message: 'Approved',
		context: 'Non-interactive state badge shown on a plan message after the user approved the plan.',
	},
	'agent.planMode.rejected': {
		message: 'Rejected',
		context: 'Non-interactive state badge shown on a plan message after the user rejected the plan.',
	},
	'agent.planMode.planLabel': {
		message: 'Plan',
		context: 'Role label shown in the header of a plan message bubble in the agent chat.',
	},
	'agent.planMode.approveNotice': {
		message: 'Plan approved. Executing…',
		context: 'Notice shown after the user approves an agent plan and execution begins.',
	},
	'agent.planMode.rejectNotice': {
		message: 'Plan rejected.',
		context: 'Notice shown after the user rejects an agent plan.',
	},
	'agent.planMode.executePrompt': {
		message: 'I approve the plan. Please execute it now.',
		context:
			'Synthetic user message sent automatically after the user approves a plan in Plan Mode, prompting the agent to begin execution.',
	},
	'agent.session.createFailed': {
		message: 'Failed to create agent session',
		context: 'Error notice when creating a new chat session fails.',
	},
	'agent.session.loadFailed': {
		message: 'Failed to load session',
		context: 'Error notice when loading a saved chat session fails.',
	},
	'agent.shelf.attachmentFallback': {
		message: 'Attachment',
		context:
			'Fallback display name for an attached binary file with no file name, shown on its chip in the attachment shelf.',
	},
	'agent.shelf.pinnedAria': {
		message: 'Included in every message',
		context:
			'Accessibility label for the pin badge on a context-file chip: the file is sent with every message in the session.',
	},
	'agent.shelf.removeAria': {
		message: 'Remove',
		context: 'Tooltip and accessibility label for the × button that removes a file chip from the attachment shelf.',
	},
	'agent.tools.copySectionAria': {
		message: 'Copy {section}',
		context:
			'Accessibility label for a copy-to-clipboard button. {section} is the section title, e.g. "Parameters" or "Result".',
	},
	'agent.tools.failedDefault': {
		message: 'Tool execution failed (no error message provided)',
		context: 'Fallback error text shown when a tool fails without reporting an error message.',
	},
	'agent.tools.completedDefault': {
		message: 'Operation completed successfully',
		context: 'Fallback result text shown when a tool succeeds but returns no data.',
	},
	'agent.tools.running': {
		message: 'Running tools... ({done} of {total})',
		context:
			'Summary line of the tool-activity block while tools are executing. {done} is the number finished, {total} the total count.',
	},
	'agent.tools.runningBadge': {
		message: 'Running',
		context: 'Status badge on the tool-activity block while tools are executing.',
	},
	'agent.tools.completedOne': {
		message: '1 tool completed',
		context: 'Summary line of the tool-activity block after a single tool finished successfully.',
	},
	'agent.tools.completedMany': {
		message: '{count} tools completed',
		context: 'Summary line of the tool-activity block after {count} (2 or more) tools finished successfully.',
	},
	'agent.tools.completedOneFailed': {
		message: '1 tool completed — {failed} failed',
		context:
			'Summary line of the tool-activity block when the single executed tool batch had failures. {failed} is the failure count. Keep the em dash.',
	},
	'agent.tools.completedManyFailed': {
		message: '{count} tools completed — {failed} failed',
		context:
			'Summary line of the tool-activity block when some of {count} tools failed. {failed} is the failure count. Keep the em dash.',
	},
	'agent.tools.permissionGranted': {
		message: 'Permission granted: {name}',
		context: 'Row in the tool-activity block acknowledging the user approved a tool. {name} is the tool display name.',
	},
	'agent.tools.runningStatus': {
		message: 'Running...',
		context: 'Status badge on an individual tool row while that tool is executing.',
	},
	'agent.tools.completedStatus': {
		message: 'Completed',
		context: 'Status badge on an individual tool row after it finished successfully.',
	},
	'agent.tools.failedStatus': { message: 'Failed', context: 'Status badge on an individual tool row after it failed.' },
	'agent.tools.parametersHeader': {
		message: 'Parameters',
		context: 'Section heading inside an expanded tool row listing the parameters the tool was called with.',
	},
	'agent.tools.resultHeader': {
		message: 'Result',
		context: "Section heading inside an expanded tool row showing the tool's output.",
	},
	'agent.tools.truncatedSuffix': {
		message: '... (truncated)',
		context: 'Suffix appended to long tool output that was cut off for display.',
	},
	'agent.tools.showFullContent': {
		message: 'Show full content',
		context: 'Button that expands truncated tool output to its full length.',
	},
	'agent.tools.noResults': {
		message: 'No results found',
		context: 'Shown in a tool result section when the tool returned an empty list.',
	},
	'agent.tools.moreItems': {
		message: '... and {count} more',
		context: 'Shown under a truncated result list. {count} is the number of items not displayed.',
	},
	'agent.tools.answerHeader': {
		message: 'Answer:',
		context: 'Heading above the answer text of a web-search tool result. Keep the trailing colon.',
	},
	'agent.tools.sourcesHeader': {
		message: 'Sources:',
		context: 'Heading above the list of citation links of a web-search tool result. Keep the trailing colon.',
	},
	'agent.tools.generatedImageHeader': {
		message: 'Generated image:',
		context: 'Heading above the preview of an AI-generated image in a tool result. Keep the trailing colon.',
	},
	'agent.tools.imagePreviewFailed': {
		message: 'Failed to load image preview',
		context: 'Shown in place of a generated image when its preview cannot be loaded.',
	},
	'agent.tools.generatedImageAlt': {
		message: 'Generated image',
		context: 'Fallback alt text for an AI-generated image preview.',
	},
	'agent.tools.pathLabel': {
		message: 'Path:',
		context: 'Label before the vault path of a generated image. A space follows in code; keep the trailing colon.',
	},
	'agent.tools.wikilinkLabel': {
		message: 'Wikilink:',
		context:
			'Label before the wikilink of a generated image. "Wikilink" is the Obsidian [[...]] link format. Keep the trailing colon.',
	},
	'agent.tools.copyButton': {
		message: 'Copy',
		context: "Button that copies the generated image's wikilink to the clipboard.",
	},
	'agent.tools.copiedButton': {
		message: 'Copied!',
		context: 'Temporary button label after the wikilink was copied to the clipboard.',
	},
	'agent.tools.imageSavedTo': {
		message: 'Image saved to: {path}',
		context: 'Shown when a generated image file exists but cannot be previewed. {path} is the vault path.',
	},
	'agent.tools.fileLabel': {
		message: 'File:',
		context: 'Label before a file path in a tool result. A space follows in code; keep the trailing colon.',
	},
	'agent.diff.previewTitle': {
		message: 'Preview: {path}',
		context: 'Tab title of the diff view when previewing a new file the AI wants to create. {path} is the file path.',
	},
	'agent.diff.reviewTitle': {
		message: 'Review changes: {path}',
		context:
			'Tab title of the diff view when reviewing AI-proposed edits to an existing file. {path} is the file path.',
	},
	'agent.diff.displayName': {
		message: 'Diff view',
		context: 'Fallback tab title of the diff view before any file is loaded.',
	},
	'agent.diff.newFileBadge': {
		message: '(new file)',
		context:
			'Badge next to the file path in the diff view indicating the file does not exist yet. Keep the parentheses.',
	},
	'agent.diff.approve': {
		message: 'Approve',
		context: 'Button in the diff view that accepts the AI-proposed file changes.',
	},
	'agent.diff.cancel': {
		message: 'Cancel',
		context: 'Button in the diff view that rejects the AI-proposed file changes.',
	},
	'agent.fileMention.placeholder': {
		message: 'Select a file or folder to mention...',
		context: 'Placeholder of the fuzzy-search modal opened by typing @ in the chat input.',
	},
	'agent.filePicker.placeholder': {
		message: 'Search files to add as context...',
		context: 'Placeholder of the file-picker modal for adding context files to the session.',
	},
	'agent.filePicker.toggleInstruction': {
		message: 'toggle selection',
		context:
			'Instruction hint at the bottom of the file picker, shown after the Enter key symbol. Lowercase by convention.',
	},
	'agent.filePicker.confirmInstruction': {
		message: 'confirm and close',
		context: 'Instruction hint at the bottom of the file picker, shown after "esc". Lowercase by convention.',
	},
	'agent.skillMention.placeholder': {
		message: 'Select a skill to activate...',
		context: 'Placeholder of the skill-picker modal opened by typing / in the empty chat input.',
	},
	'agent.projectPicker.title': {
		message: 'Switch project',
		context: 'Heading of the modal for linking the session to a different project.',
	},
	'agent.projectPicker.noProjectDesc': {
		message: 'Use default vault-wide scope',
		context: 'Description under the "No Project" option in the project picker: the agent operates on the whole vault.',
	},
	'agent.projectPicker.empty': {
		message: 'No projects found. Create a note with the gemini-scribe/project tag to get started.',
		context: 'Empty state of the project picker. "gemini-scribe/project" is a literal tag name — do not translate it.',
	},
	'agent.projectPicker.vaultRoot': {
		message: '(vault root)',
		context: "Shown as a project's root path when the project covers the entire vault. Keep the parentheses.",
	},
	'agent.sessionList.title': {
		message: 'Agent sessions',
		context: 'Heading of the modal listing saved agent chat sessions.',
	},
	'agent.sessionList.empty': { message: 'No agent sessions found', context: 'Empty state of the session list modal.' },
	'agent.sessionList.loadFailed': {
		message: 'Failed to load agent sessions',
		context: 'Error notice when the saved session list cannot be loaded.',
	},
	'agent.sessionList.filterLabel': {
		message: 'Project:',
		context:
			'Label before the project filter dropdown in the session list. A space follows in code; keep the trailing colon.',
	},
	'agent.sessionList.filterAll': {
		message: 'All projects',
		context: 'Filter dropdown option showing sessions from all projects.',
	},
	'agent.sessionList.noFilterMatch': {
		message: 'No sessions match the selected filter',
		context: 'Shown in the session list when the project filter matches no sessions.',
	},
	'agent.sessionList.fileCountOne': {
		message: '1 file',
		context: 'Session metadata: the session has exactly one context file.',
	},
	'agent.sessionList.fileCount': {
		message: '{count} files',
		context: 'Session metadata: the session has {count} (0, 2, or more) context files.',
	},
	'agent.sessionList.openTooltip': {
		message: 'Open session',
		context: 'Tooltip on the arrow button that opens a session from the list.',
	},
	'agent.sessionList.deleteTooltip': {
		message: 'Delete session',
		context: 'Tooltip on the trash button that deletes a session from the list.',
	},
	'agent.sessionList.deleteConfirm': {
		message: 'Delete session "{title}"?',
		context: 'Browser confirmation dialog before deleting a session. {title} is the session title.',
	},
	'agent.sessionList.deleted': {
		message: 'Session "{title}" deleted',
		context: 'Notice after a session was deleted. {title} is the session title.',
	},
	'agent.sessionList.deleteFailed': {
		message: 'Failed to delete session',
		context: 'Error notice when deleting a session fails.',
	},
	'agent.sessionSettings.model': {
		message: 'Model',
		context: 'Setting name in the session settings modal: which AI model to use.',
	},
	'agent.sessionSettings.modelDesc': {
		message: 'Select the AI model for this session',
		context: 'Description of the Model setting in the session settings modal.',
	},
	'agent.sessionSettings.useDefault': {
		message: 'Use default',
		context: 'Dropdown option meaning the session uses the plugin-wide default model.',
	},
	'agent.sessionSettings.resetToDefault': {
		message: 'Reset to default',
		context: 'Tooltip on the reset button next to each session setting.',
	},
	'agent.sessionSettings.temperature': {
		message: 'Temperature',
		context: 'Setting name: the AI sampling temperature parameter.',
	},
	'agent.sessionSettings.temperatureDesc': {
		message: 'Controls randomness (0 = deterministic, 2 = very creative)',
		context: 'Description of the Temperature setting.',
	},
	'agent.sessionSettings.topP': {
		message: 'Top-P',
		context: 'Setting name: the nucleus-sampling parameter. Usually kept as "Top-P" in all languages.',
	},
	'agent.sessionSettings.topPDesc': {
		message: 'Nucleus sampling threshold (0 = only top token, 1 = all tokens)',
		context: 'Description of the Top-P setting. "Token" is the AI text-unit term.',
	},
	'agent.sessionSettings.promptTemplate': {
		message: 'Prompt template',
		context: 'Setting name: which custom prompt template the session uses.',
	},
	'agent.sessionSettings.promptTemplateDesc': {
		message: 'Select a custom prompt template for this session',
		context: 'Description of the Prompt Template setting.',
	},
	'agent.sessionSettings.useDefaultPrompt': {
		message: 'Use default prompt',
		context: 'Dropdown option meaning the session uses the built-in default prompt.',
	},
	'agent.sessionSettings.info': {
		message: 'These settings override the global defaults for this session only. Changes are saved automatically.',
		context: 'Informational footer text of the session settings modal.',
	},

	// --- main ---
	'command.openAgentView': {
		message: 'Open Gemini chat',
		context: 'Command palette entry that opens the Gemini agent chat side panel.',
	},
	'command.refreshModelList': {
		message: 'Refresh model list',
		context: 'Command palette entry that re-fetches the remote Gemini model list, bypassing the 24h cache.',
	},
	'command.viewBackgroundTasks': {
		message: 'View background tasks',
		context: 'Command palette entry that opens the background tasks modal (deep research, image generation jobs).',
	},
	'command.openScheduler': {
		message: 'Open scheduler',
		context: 'Command palette entry that opens the scheduled-task management modal in list view.',
	},
	'command.newScheduledTask': {
		message: 'New scheduled task',
		context: 'Command palette entry that opens the scheduler modal directly on the create-task form.',
	},
	'command.openHookManager': {
		message: 'Open hook manager',
		context: 'Command palette entry that opens the lifecycle hook management modal in list view.',
	},
	'command.newHook': {
		message: 'New lifecycle hook',
		context: 'Command palette entry that opens the hook manager directly on the create-hook form.',
	},
	'command.viewScheduledTasks': {
		message: 'View scheduled tasks',
		context: 'Command palette entry for the legacy read-only scheduled tasks modal.',
	},
	'command.switchProject': {
		message: 'Switch project',
		context: 'Command palette entry that opens the agent view so the user can switch the active project.',
	},
	'command.createProject': {
		message: 'Create project',
		context: 'Command palette entry that creates a new project note in the current folder.',
	},
	'command.convertToProject': {
		message: 'Convert note to project',
		context: 'Command palette entry that converts the active note into a Gemini Scribe project.',
	},
	'command.openProjectSettings': {
		message: 'Open project settings',
		context: 'Command palette entry that opens a project file (shows a picker when multiple projects exist).',
	},
	'command.resumeProjectSession': {
		message: 'Resume project session',
		context: 'Command palette entry that reopens the most recent agent session linked to a chosen project.',
	},
	'command.removeProject': {
		message: 'Remove project',
		context: 'Command palette entry that removes project status from the active note.',
	},
	'command.rewriteSelection': {
		message: 'Rewrite text with AI',
		context: 'Command palette entry that rewrites the selected editor text using AI.',
	},
	'command.explainSelection': {
		message: 'Explain selection with AI',
		context: 'Command palette entry that asks the AI to explain the selected editor text.',
	},
	'command.askSelection': {
		message: 'Ask about selection',
		context: 'Command palette entry that lets the user ask the AI a question about the selected text.',
	},
	'command.viewReleaseNotes': {
		message: 'View release notes',
		context: 'Command palette entry that opens the modal showing the plugin release notes for the current version.',
	},
	'command.generateImage': {
		message: 'Generate image',
		context: 'Command palette entry that prompts for a description and generates an image with Gemini.',
	},
	'command.ragPause': {
		message: 'Pause RAG sync',
		context: 'Command palette entry that pauses RAG (vault search index) synchronization.',
	},
	'command.ragResume': {
		message: 'Resume RAG sync',
		context: 'Command palette entry that resumes a paused RAG (vault search index) synchronization.',
	},
	'command.ragStatus': {
		message: 'Show RAG status',
		context: 'Command palette entry that opens the RAG indexing status modal.',
	},
	'command.newSession': {
		message: 'New agent session',
		context: 'Command palette entry that opens the agent view and starts a fresh agent chat session.',
	},
	'command.browseSessions': {
		message: 'Browse agent sessions',
		context: 'Command palette entry that opens the agent view and shows the list of past sessions.',
	},
	'command.linkProject': {
		message: 'Link project to agent session',
		context: 'Command palette entry that links a project to the current agent chat session.',
	},
	'command.sessionSettings': {
		message: 'Agent session settings',
		context: 'Command palette entry that opens the settings panel for the current agent session.',
	},
	'command.togglePlanMode': {
		message: 'Toggle Plan Mode',
		context:
			'Command palette entry that toggles Plan Mode in the agent view. In Plan Mode the agent produces a structured plan for approval before executing any actions.',
	},
	'ribbon.agentMode': {
		message: 'Gemini Scribe: Agent mode',
		context:
			'Tooltip of the sidebar ribbon icon that opens the Gemini agent chat view. "Gemini Scribe" is the plugin name and should not be translated.',
	},
	'menu.main.rewriteText': {
		message: 'Gemini Scribe: Rewrite text...',
		context:
			'Editor right-click context menu item that rewrites the selected text with AI. "Gemini Scribe" is the plugin name and should not be translated.',
	},
	'menu.main.askQuestion': {
		message: 'Gemini Scribe: Ask question...',
		context:
			'Editor right-click context menu item to ask the AI a question about the selected text. "Gemini Scribe" is the plugin name and should not be translated.',
	},
	'menu.main.applyPrompt': {
		message: 'Gemini Scribe: Apply prompt...',
		context:
			'Editor right-click context menu item to apply a saved prompt to the selected text. "Gemini Scribe" is the plugin name and should not be translated.',
	},
	'notice.main.initFailedFix': {
		message: 'Gemini Scribe failed to initialize: {error}. Open Settings → Gemini Scribe to fix.',
		context:
			'Error notice when plugin initialization failed; {error} is the underlying error message. "Gemini Scribe" is the plugin name.',
	},
	'notice.main.ollamaUnreachable': {
		message:
			'Could not reach Ollama at {url}. Make sure the Ollama daemon is running and the base URL is correct in Settings → Gemini Scribe.',
		context: 'Error notice when the local Ollama server cannot be reached; {url} is the configured base URL.',
	},
	'notice.main.noApiKey': {
		message:
			'No Gemini API key configured. Open Settings → Gemini Scribe to add one. Get a free key at aistudio.google.com/apikey',
		context: 'Error notice when the user has not configured a Gemini API key yet.',
	},
	'notice.main.apiKeyRetrieveFailed': {
		message:
			'Could not retrieve your API key from secure storage. Try re-entering it in Settings → Gemini Scribe → API key.',
		context: 'Error notice when the stored API key could not be read back from Obsidian secret storage.',
	},
	'notice.main.initFailedConsole': {
		message: 'Gemini Scribe failed to initialize: {error}. Check the console for details.',
		context: 'Error notice for a generic plugin initialization failure; {error} is the underlying error message.',
	},
	'notice.main.projectCreated': {
		message: 'Created project: {path}',
		context: 'Success notice after creating a new project note; {path} is the vault file path of the project.',
	},
	'notice.main.projectCreateFailed': {
		message: 'Failed to create project',
		context: 'Error notice when creating a new project note failed.',
	},
	'notice.main.convertedToProject': {
		message: 'Converted to project: {name}',
		context: 'Success notice after converting a note into a project; {name} is the note filename without extension.',
	},
	'notice.main.convertToProjectFailed': {
		message: 'Failed to convert note to project',
		context: 'Error notice when converting a note into a project failed.',
	},
	'notice.main.noProjectsFound': {
		message: 'No projects found',
		context: 'Notice shown when a project-related command runs but the vault contains no projects.',
	},
	'notice.main.noSessionsForProject': {
		message: 'No sessions found for project: {name}',
		context:
			'Notice when resuming a project session but no agent sessions are linked to that project; {name} is the project name.',
	},
	'notice.main.projectRemoved': {
		message: 'Removed project status from: {name}',
		context: 'Success notice after removing project status from a note; {name} is the note filename without extension.',
	},
	'notice.main.projectRemoveFailed': {
		message: 'Failed to remove project status',
		context: 'Error notice when removing project status from a note failed.',
	},
	'notice.main.selectTextFirst': {
		message: 'Please select some text first',
		context: 'Notice when the user invokes a selection-based AI action without any text selected in the editor.',
	},
	'notice.main.imageGenOllama': {
		message: 'Image generation is not available with the Ollama provider.',
		context:
			'Notice when the Generate Image command is used while the local Ollama provider is active (feature is Gemini-only).',
	},
	'notice.main.imageGenUnavailable': {
		message: 'Image generation is not available.',
		context: 'Notice when the image generation service is not initialized.',
	},
	'notice.main.ragOllamaUnavailable': {
		message: 'RAG sync is not available with the Ollama provider in phase 1.',
		context: 'Notice when a RAG (vault search index) command is used while the Ollama provider is active.',
	},
	'notice.main.ragNotEnabled': {
		message: 'RAG indexing is not enabled',
		context: 'Notice when a RAG command is used but RAG indexing is disabled in settings.',
	},
	'notice.main.ragAlreadyPaused': {
		message: 'RAG sync is already paused',
		context: 'Notice when the user tries to pause RAG sync but it is already paused.',
	},
	'notice.main.ragCannotPauseWhileIndexing': {
		message: 'Cannot pause while indexing is in progress',
		context: 'Notice when the user tries to pause RAG sync during an active indexing run.',
	},
	'notice.main.ragPaused': {
		message: 'RAG sync paused',
		context: 'Confirmation notice after RAG synchronization was paused.',
	},
	'notice.main.ragNotPaused': {
		message: 'RAG sync is not paused',
		context: 'Notice when the user tries to resume RAG sync but it is not paused.',
	},
	'notice.main.ragResumed': {
		message: 'RAG sync resumed',
		context: 'Confirmation notice after RAG synchronization was resumed.',
	},
	'notice.main.ragIndexComplete': {
		message: 'RAG indexing complete: {indexed} indexed, {skipped} unchanged',
		context:
			'Notice after a full RAG index run; {indexed} is the number of files indexed and {skipped} the number left unchanged.',
	},
	'notice.main.ragIndexFailed': {
		message: 'RAG indexing failed: {error}',
		context: 'Error notice when a RAG vault indexing run failed; {error} is the underlying error message.',
	},
	'notice.main.ragSyncingPending': {
		message: 'RAG index: Syncing pending changes...',
		context: 'Notice shown while pending vault changes are being synced into the RAG index.',
	},
	'notice.main.readyToUse': {
		message: 'Gemini Scribe is now ready to use!',
		context:
			'Success notice after the plugin initializes for the first time once credentials are configured. "Gemini Scribe" is the plugin name.',
	},
	'component.managementModalBase.managerUnavailable': {
		message: '{label} manager not available.',
		context:
			'Error text in the hooks/scheduled-tasks management modal when the backing manager service is missing; {label} is the lowercase entity type, e.g. "hook" or "task".',
	},
	'component.managementModalBase.deleteConfirm': {
		message: 'Delete "{slug}"? This removes the {label} definition file permanently.',
		context:
			'Delete confirmation question in the management modal; {slug} is the entity name and {label} is the lowercase entity type, e.g. "hook" or "task".',
	},
	'component.managementModalBase.cancel': {
		message: 'Cancel',
		context: 'Button that cancels the delete confirmation or the create/edit form in the management modal.',
	},
	'component.managementModalBase.delete': {
		message: 'Delete',
		context: 'Button that confirms deleting a hook or scheduled task in the management modal.',
	},
	'component.managementModalBase.deleting': {
		message: 'Deleting...',
		context: 'In-progress label shown on the delete button while the deletion is running.',
	},
	'component.managementModalBase.deleted': {
		message: '{label} "{slug}" deleted',
		context:
			'Success notice after deleting an entity; {label} is the capitalized entity type (e.g. "Hook", "Task") and {slug} the entity name.',
	},
	'component.managementModalBase.deleteFailed': {
		message: 'Failed to delete "{slug}"',
		context: 'Error notice when deleting a hook or scheduled task failed; {slug} is the entity name.',
	},
	'component.managementModalBase.backToList': {
		message: '← Back to list',
		context: 'Button on the create/edit form of the management modal that returns to the entity list view.',
	},
	'component.managementModalBase.slugName': {
		message: '{label} name (slug)',
		context:
			'Setting name for the slug field in the create form; {label} is the capitalized entity type, e.g. "Hook" or "Task".',
	},
	'component.managementModalBase.slugDesc': {
		message: 'Lowercase identifier used as the filename and in output paths. Cannot be changed after creation.',
		context: 'Description below the slug field in the management modal create form.',
	},
	'component.managementModalBase.saveChanges': {
		message: 'Save changes',
		context: 'Primary button on the edit form of the management modal that saves changes to an existing entity.',
	},
	'component.managementModalBase.createEntity': {
		message: 'Create {label}',
		context:
			'Primary button on the create form of the management modal; {label} is the lowercase entity type, e.g. "hook" or "task".',
	},
	'component.toolPolicyEditor.title': {
		message: 'Tool access',
		context: 'Default heading of the tool policy editor block embedded in hook/task forms.',
	},
	'component.toolPolicyEditor.inheritGlobal': {
		message: 'Inherit global plugin tool policy',
		context:
			'Checkbox label in the tool policy editor; when checked the feature uses the plugin-wide tool policy instead of a custom one.',
	},
	'component.toolPolicyEditor.presetLabel': {
		message: 'Preset:',
		context: 'Label before the preset dropdown in the tool policy editor.',
	},
	'component.toolPolicyEditor.noPreset': {
		message: '(no preset — use global preset)',
		context: 'Dropdown option in the tool policy editor meaning no feature-specific preset; the global preset applies.',
	},
	'component.toolPolicyEditor.perToolOverrides': {
		message: 'Per-tool overrides',
		context: 'Subheading above the table of per-tool permission overrides in the tool policy editor.',
	},
	'component.toolPolicyEditor.noToolsRegistered': {
		message: 'No tools registered.',
		context: 'Placeholder text in the tool policy editor when the tool registry contains no tools.',
	},
	'component.toolPolicyEditor.inheritOption': {
		message: '(inherit)',
		context:
			'Dropdown option for a single tool in the overrides table meaning the tool inherits its permission from the preset or global policy.',
	},

	// --- services ---
	'notice.backgroundTask.failed': {
		message: 'Background task failed: {label}\n{error}',
		context:
			'Toast notification when a background task (deep research, image generation) fails. {label} is the task name, {error} the failure reason.',
	},
	'notice.backgroundTask.complete': {
		message: '✓ {label} complete.',
		context: 'Toast notification when a background task finishes successfully. {label} is the task name.',
	},
	'notice.backgroundTask.openResult': {
		message: 'Open result',
		context: 'Clickable link inside the task-complete toast that opens the output note.',
	},
	'notice.rag.resuming': {
		message: 'RAG indexing: Resuming interrupted indexing...',
		context:
			'Toast notification when the user chooses to resume a previously interrupted vault search indexing run. RAG is a technical term (retrieval-augmented generation); keep the "RAG Indexing" prefix.',
	},
	'notice.rag.startingFresh': {
		message: 'RAG indexing: Starting fresh...',
		context: 'Toast notification when the user chooses to discard the interrupted index and rebuild from scratch.',
	},
	'notice.rag.indexingComplete': {
		message: 'RAG indexing complete: {indexed} indexed, {skipped} unchanged',
		context: 'Toast notification when vault search indexing finishes. {indexed} and {skipped} are file counts.',
	},
	'notice.rag.indexingFailed': {
		message: 'RAG indexing failed: {error}',
		context: 'Toast notification when vault search indexing fails. {error} is the error message.',
	},
	'notice.rag.startFreshFailed': {
		message: 'RAG indexing: Failed to start fresh: {error}',
		context: 'Toast notification when rebuilding the search index from scratch fails. {error} is the error message.',
	},
	'notice.rag.initFailed': {
		message: 'Failed to initialize vault search index. Check console for details.',
		context: 'Toast notification when the vault search (RAG) service fails to start during plugin load.',
	},
	'notice.rag.startingInitial': {
		message: 'RAG indexing: Starting initial vault indexing...',
		context: 'Toast notification when the very first vault search indexing run begins.',
	},
	'notice.rag.indexingSummary': {
		message: 'RAG indexing: {indexed} indexed, {skipped} unchanged',
		context:
			'Toast notification summarizing indexing progress when the progress dialog is closed mid-run. {indexed} and {skipped} are file counts.',
	},
	'notice.rag.syncingPending': {
		message: 'RAG index: Syncing pending changes...',
		context:
			'Toast notification when the user triggers an immediate sync of files changed since the last indexing run.',
	},
	'notice.rag.uiError': {
		message: 'RAG indexing UI error: {error}',
		context: 'Toast notification when opening the indexing status dialog fails. {error} is the error message.',
	},
	'notice.selection.noSelection': {
		message: 'Please select some text first',
		context:
			'Toast notification when a selection-based action (Explain/Ask about selection) is invoked with no text selected in the editor.',
	},
	'notice.selection.noPrompts': {
		message: 'No selection action prompts found. Create prompts with the "gemini-scribe/selection-prompt" tag.',
		context:
			'Toast notification when no custom prompts are tagged for selection actions. "gemini-scribe/selection-prompt" is a literal tag name — do not translate it.',
	},
	'notice.image.noActiveNote': {
		message: 'No active note. Please open a note first.',
		context: 'Toast notification when image generation is invoked without an open note to insert the image into.',
	},
	'notice.image.submitted': {
		message: 'Image generation submitted — you can keep working.',
		context: 'Toast notification confirming an image generation request was queued as a background task.',
	},
	'notice.image.generating': {
		message: 'Generating image...',
		context: 'Toast notification shown while an image is being generated synchronously.',
	},
	'notice.image.inserted': {
		message: 'Image generated and inserted successfully!',
		context: 'Toast notification when a generated image was saved and its link inserted into the note.',
	},
	'notice.image.generateFailed': {
		message: 'Failed to generate image: {error}',
		context: 'Toast notification when image generation fails. {error} is the error message.',
	},
	'notice.image.savedManualInsert': {
		message: 'Image saved ({reason}). Wikilink: {wikilink}',
		context:
			'Toast notification when a generated image was saved but its link could not be auto-inserted. {reason} is a translated explanation; {wikilink} is the Obsidian link text the user can paste manually.',
	},
	'notice.image.reasonNoteClosed': {
		message: 'note is no longer open',
		context:
			'Reason fragment inserted into the "Image saved ({reason})" notice when the target note was closed before insertion.',
	},
	'notice.image.reasonCursorInvalid': {
		message: 'cursor position is no longer valid',
		context:
			'Reason fragment inserted into the "Image saved ({reason})" notice when the remembered cursor position no longer exists.',
	},
	'notice.image.promptGenerated': {
		message: 'Prompt generated! Feel free to edit it before generating the image.',
		context: 'Toast notification after AI suggests an image-generation prompt based on the current page.',
	},
	'notice.image.promptFailed': {
		message: 'Failed to generate prompt: {error}',
		context: 'Toast notification when AI prompt suggestion for image generation fails. {error} is the error message.',
	},
	'notice.vaultAnalysis.parseFailed': {
		message: 'Failed to parse AI response. Check console for details.',
		context: 'Toast notification when the AI response during vault context (AGENTS.md) generation cannot be parsed.',
	},
	'notice.vaultAnalysis.created': {
		message: 'Vault context created successfully!',
		context:
			'Success message (toast and progress dialog) when the AGENTS.md vault context file is created for the first time.',
	},
	'notice.vaultAnalysis.updated': {
		message: 'Vault context updated successfully!',
		context:
			'Success message (toast and progress dialog) when an existing AGENTS.md vault context file is regenerated.',
	},
	'notice.vaultAnalysis.initFailed': {
		message: 'Failed to initialize AGENTS.md. Check console for details.',
		context: 'Toast notification when vault context (AGENTS.md) generation fails. AGENTS.md is a literal filename.',
	},
	'notice.mcp.authorizing': {
		message: 'MCP: Authorizing "{name}" — check your browser',
		context:
			'Toast notification when an MCP server requires OAuth login and the browser was opened. {name} is the server name; MCP is a technical acronym, keep it.',
	},
	'notice.fileUtils.createFolderFailed': {
		message: 'Gemini Scribe: Failed to create folder "{path}"{label}: {message}',
		context:
			'Toast notification when the plugin cannot create a vault folder. {path} is the folder path, {label} is an optional parenthesized purpose (may be empty), {message} is the error message.',
	},
	'notice.prompt.nameEmpty': {
		message: 'Prompt name cannot be empty',
		context: 'Toast notification when the user submits the new-custom-prompt dialog with an empty name.',
	},
	'notice.prompt.nameInvalid': {
		message: 'Invalid prompt name. Please use alphanumeric characters, spaces, hyphens, or underscores.',
		context: 'Toast notification when the new custom prompt name contains only disallowed characters.',
	},
	'notice.prompt.alreadyExists': {
		message: 'A prompt file named "{fileName}" already exists.',
		context:
			'Toast notification when creating a custom prompt would overwrite an existing file. {fileName} is the markdown filename.',
	},
	'notice.prompt.created': {
		message: 'Created new custom prompt: {name}',
		context:
			'Toast notification after a new custom prompt file is created. {name} is the prompt name the user entered.',
	},
	'notice.prompt.createFileFailed': {
		message: 'Failed to create prompt file',
		context: 'Toast notification when writing the new custom prompt file to the vault fails.',
	},
	'notice.prompt.createFailed': {
		message: 'Failed to create new custom prompt',
		context: 'Toast notification when the create-custom-prompt flow fails before the file is written.',
	},
	'notice.summary.noActiveFile': {
		message: 'No active file to summarize. Please open a markdown file first.',
		context: 'Toast notification when the Summarize Active File command runs with no open markdown file.',
	},
	'notice.summary.success': {
		message: 'Summary added to frontmatter successfully!',
		context: 'Toast notification when a note summary was generated and written into the note frontmatter.',
	},
	'notice.summary.failed': {
		message: 'Failed to generate summary: {error}',
		context: 'Toast notification when note summarization fails. {error} is the error message.',
	},
	'notice.completions.enabled': {
		message: 'Gemini Scribe completions are now enabled.',
		context: 'Toast notification when the user toggles inline text completions on. "Gemini Scribe" is the plugin name.',
	},
	'notice.completions.disabled': {
		message: 'Gemini Scribe completions are now disabled.',
		context:
			'Toast notification when the user toggles inline text completions off. "Gemini Scribe" is the plugin name.',
	},
	'tool.confirm.createSkill': {
		message: 'Create new skill "{name}":\n\n{description}',
		context:
			'Confirmation prompt shown in the agent chat before the AI creates a new skill. {name} is the skill name, {description} a truncated description preview.',
	},
	'tool.confirm.editSkillNoFields': {
		message: 'Edit skill "{name}": no valid fields provided',
		context:
			'Confirmation prompt shown when the AI asks to edit a skill but supplied neither a new description nor new content.',
	},
	'tool.confirm.editSkillDescription': {
		message: 'Edit skill "{name}": updating description',
		context: 'Confirmation prompt shown before the AI updates only the description of an existing skill.',
	},
	'tool.confirm.editSkillContent': {
		message: 'Edit skill "{name}": updating content',
		context: 'Confirmation prompt shown before the AI updates only the instruction content of an existing skill.',
	},
	'tool.confirm.editSkillBoth': {
		message: 'Edit skill "{name}": updating description and content',
		context:
			'Confirmation prompt shown before the AI updates both the description and the instruction content of an existing skill.',
	},
	'tool.confirm.generateImage': {
		message: 'Generate an image with prompt: "{prompt}"?\n\nThis will create a new image file in your vault.',
		context:
			'Confirmation prompt shown in the agent chat before the AI generates an image. {prompt} is the image description.',
	},
	'tool.confirm.generateImageDestination': {
		message: 'Destination: {path}',
		context:
			'Extra line appended to the image generation confirmation prompt when a target file path was specified. {path} is a vault file path.',
	},
	'tool.confirm.deepResearchVaultOnly': {
		message: 'Conduct deep research on: "{topic}" using vault notes only',
		context:
			"Confirmation prompt shown before the AI runs deep research restricted to the user's vault notes. {topic} is the research topic.",
	},
	'tool.confirm.deepResearchWebOnly': {
		message: 'Conduct deep research on: "{topic}" using web search only',
		context:
			'Confirmation prompt shown before the AI runs deep research using only web search. {topic} is the research topic.',
	},
	'tool.confirm.deepResearchVaultAndWeb': {
		message: 'Conduct deep research on: "{topic}" using vault and web',
		context:
			'Confirmation prompt shown before the AI runs deep research combining vault notes and web search. {topic} is the research topic.',
	},
	'tool.confirm.updateFrontmatter': {
		message: 'Update frontmatter in {path}: set "{key}" to "{value}"',
		context:
			'Confirmation prompt shown before the AI changes a YAML frontmatter property. {path} is the note path, {key} the property name, {value} the new value.',
	},
	'tool.confirm.appendFile': {
		message: 'Append content to file: {path}\n\nContent preview:\n{preview}',
		context:
			'Confirmation prompt shown before the AI appends text to a note. {path} is the note path, {preview} a truncated preview of the text.',
	},
	'tool.confirm.addMemory': {
		message: 'Add the following to AGENTS.md memory:\n\n{preview}',
		context:
			'Confirmation prompt shown before the AI saves information to the AGENTS.md vault memory file. {preview} is a truncated preview. AGENTS.md is a literal filename.',
	},
	'tool.confirm.writeFileSummary': {
		message: 'Write to file: {path}\n\n{summary}',
		context:
			'Confirmation prompt shown before the AI writes a file, when it provided a human-readable summary of the change. {path} is the file path.',
	},
	'tool.confirm.writeFile': {
		message: 'Write content to file: {path}\n\nContent preview:\n{preview}',
		context:
			'Confirmation prompt shown before the AI writes a file, with a truncated preview of the new content. {path} is the file path.',
	},
	'tool.confirm.deleteFile': {
		message:
			'Delete file or folder: {path}\n\nThis follows your Obsidian "Deleted files" setting (move to system trash, the vault\'s .trash folder, or permanent deletion).',
		context: 'Confirmation prompt shown before the AI deletes a file or folder. {path} is the vault path.',
	},
	'tool.confirm.createFolder': {
		message: 'Create folder: {path}',
		context: 'Confirmation prompt shown before the AI creates a new folder. {path} is the folder path.',
	},
	'tool.confirm.moveFile': {
		message: 'Move file or folder from: {source}\nTo: {target}',
		context:
			'Confirmation prompt shown before the AI moves or renames a file or folder. {source} and {target} are vault paths.',
	},
	'modal.generateImage.title': {
		message: 'Generate image',
		context: 'Heading of the dialog where the user describes an image to generate.',
	},
	'modal.generateImage.descriptionName': {
		message: 'Image description',
		context: 'Label of the text area where the user types the image prompt in the Generate Image dialog.',
	},
	'modal.generateImage.descriptionDesc': {
		message: 'Describe the image you want to generate',
		context: 'Help text under the image description field in the Generate Image dialog.',
	},
	'modal.generateImage.placeholder': {
		message: 'A serene landscape with mountains and a lake...',
		context: 'Placeholder example text inside the image description text area.',
	},
	'modal.generateImage.suggestName': {
		message: 'Generate prompt from current page',
		context: 'Label of the setting row offering AI-suggested image prompts in the Generate Image dialog.',
	},
	'modal.generateImage.suggestDesc': {
		message: "Let AI suggest an image prompt based on this page's content",
		context: 'Help text for the AI prompt suggestion button in the Generate Image dialog.',
	},
	'modal.generateImage.suggestButton': {
		message: 'Generate prompt from page',
		context: 'Button that asks AI to suggest an image prompt based on the open note.',
	},
	'modal.generateImage.generateButton': {
		message: 'Generate image',
		context: 'Primary button that starts image generation in the Generate Image dialog.',
	},
	'modal.generateImage.cancelButton': {
		message: 'Cancel',
		context: 'Button that closes the Generate Image dialog without generating.',
	},
	'modal.generateImage.generatingButton': {
		message: 'Generating...',
		context: 'Temporary button label while AI is generating a suggested image prompt.',
	},
	'modal.promptName.title': {
		message: 'Create new custom prompt',
		context: 'Heading of the dialog asking the user to name a new custom prompt.',
	},
	'modal.promptName.label': {
		message: 'Prompt name:',
		context: 'Label above the text input for the new custom prompt name.',
	},
	'modal.promptName.placeholder': {
		message: 'Enter a name for your custom prompt...',
		context: 'Placeholder text inside the custom prompt name input.',
	},
	'modal.promptName.cancel': {
		message: 'Cancel',
		context: 'Button that closes the new custom prompt dialog without creating anything.',
	},
	'modal.promptName.create': {
		message: 'Create',
		context: 'Button that confirms creating the new custom prompt file.',
	},
	'modal.vaultAnalysis.stepCollect': {
		message: 'Collecting vault information',
		context: 'Step label in the vault analysis progress dialog (generating the AGENTS.md context file).',
	},
	'modal.vaultAnalysis.stepAnalyze': {
		message: 'Analyzing with {model}',
		context: 'Step label in the vault analysis progress dialog. {model} is the AI model name.',
	},
	'modal.vaultAnalysis.stepParse': {
		message: 'Processing results',
		context: 'Step label in the vault analysis progress dialog.',
	},
	'modal.vaultAnalysis.stepRender': {
		message: 'Rendering template',
		context: 'Step label in the vault analysis progress dialog.',
	},
	'modal.vaultAnalysis.stepWrite': {
		message: 'Writing AGENTS.md',
		context: 'Step label in the vault analysis progress dialog. AGENTS.md is a literal filename.',
	},
	'modal.vaultAnalysis.stepExamples': {
		message: 'Generating example prompts',
		context: 'Step label in the vault analysis progress dialog.',
	},
	'modal.vaultAnalysis.stepSaveExamples': {
		message: 'Saving example prompts',
		context: 'Step label in the vault analysis progress dialog.',
	},
	'modal.vaultAnalysis.statusAnalyzing': {
		message: 'Analyzing vault structure...',
		context: 'Status line in the vault analysis progress dialog while vault files are scanned.',
	},
	'modal.vaultAnalysis.statusGenerating': {
		message: 'Generating vault context with {model}...',
		context:
			'Status line in the vault analysis progress dialog while the AI generates the vault context. {model} is the AI model name.',
	},
	'modal.vaultAnalysis.statusProcessing': {
		message: 'Processing response...',
		context: 'Status line in the vault analysis progress dialog while the AI response is parsed.',
	},
	'modal.vaultAnalysis.statusRendering': {
		message: 'Rendering content...',
		context:
			'Status line in the vault analysis progress dialog while the AGENTS.md content is rendered from a template.',
	},
	'modal.vaultAnalysis.statusWriting': {
		message: 'Writing AGENTS.md...',
		context:
			'Status line in the vault analysis progress dialog while the AGENTS.md file is written. AGENTS.md is a literal filename.',
	},
	'modal.vaultAnalysis.statusExamples': {
		message: 'Generating example prompts with {model}...',
		context:
			'Status line in the vault analysis progress dialog while example prompts are generated. {model} is the AI model name.',
	},
	'modal.vaultAnalysis.statusSavingExamples': {
		message: 'Saving example prompts...',
		context: 'Status line in the vault analysis progress dialog while example prompts are saved.',
	},
	'modal.vaultAnalysis.parseFailedStep': {
		message: 'Failed to parse AI response',
		context: 'Failure reason shown on the parse step of the vault analysis progress dialog.',
	},
	'modal.vaultAnalysis.unknownError': {
		message: 'Unknown error',
		context: 'Fallback failure reason in the vault analysis progress dialog when the thrown error has no message.',
	},
	'statusbar.background.oneTask': {
		message: '1 task',
		context: 'Status bar label when exactly one background task is running.',
	},
	'statusbar.background.taskCount': {
		message: '{count} tasks',
		context: 'Status bar label when multiple background tasks are running. {count} is 2 or more.',
	},
	'statusbar.background.runningOne': {
		message: '1 background task running — click to view',
		context: 'Status bar tooltip when exactly one background task is running.',
	},
	'statusbar.background.runningMany': {
		message: '{count} background tasks running — click to view',
		context: 'Status bar tooltip when multiple background tasks are running. {count} is 2 or more.',
	},
	'statusbar.background.missedOne': {
		message: '1 missed scheduled run — click to review',
		context:
			'Status bar tooltip when one scheduled task run was missed (e.g. Obsidian was closed) and awaits approval.',
	},
	'statusbar.background.missedMany': {
		message: '{count} missed scheduled runs — click to review',
		context:
			'Status bar tooltip when multiple scheduled task runs were missed and await approval. {count} is 2 or more.',
	},
	'statusbar.background.ragIndexing': {
		message: 'RAG: indexing{progress}',
		context:
			'Status bar tooltip fragment while vault search indexing runs. {progress} is either empty or a pre-formatted " (current/total)" counter including the leading space.',
	},
	'statusbar.background.ragPaused': {
		message: 'RAG: paused ({count} files indexed)',
		context:
			'Status bar tooltip fragment when vault search indexing is paused. {count} is the number of files indexed so far.',
	},
	'statusbar.background.ragError': {
		message: 'RAG: error — check settings',
		context: 'Status bar tooltip fragment when vault search indexing is in an error state.',
	},
	'statusbar.background.ragRateLimited': {
		message: 'RAG: rate limited ({seconds}s)',
		context:
			'Status bar tooltip fragment when indexing is paused due to API rate limits. {seconds} is the wait time remaining.',
	},
	'statusbar.rag.indexed': {
		message: 'RAG index: {count} files indexed',
		context: 'Status bar tooltip when the vault search index is idle. {count} is the number of indexed files.',
	},
	'statusbar.rag.uploading': {
		message: 'RAG index: Uploading {current}/{total}...',
		context:
			'Status bar tooltip while vault files are uploaded to the search index. {current} and {total} are file counts.',
	},
	'statusbar.rag.indexing': {
		message: 'RAG index: Indexing...',
		context: 'Status bar tooltip while indexing runs but total progress is not yet known.',
	},
	'statusbar.rag.error': {
		message: 'RAG index: Error - click for details',
		context: 'Status bar tooltip when vault search indexing hit an error.',
	},
	'statusbar.rag.paused': {
		message: 'RAG index: Paused',
		context: 'Status bar tooltip when vault search indexing is paused.',
	},
	'statusbar.rag.rateLimited': {
		message: 'RAG index: Rate limited - waiting {seconds}s',
		context: 'Status bar tooltip when indexing is waiting out an API rate limit. {seconds} is the wait time remaining.',
	},

	// --- tool policy labels ---
	'toolPolicy.preset.readOnly': {
		message: 'Read only',
		context: 'Tool permission preset name: agent may only read, never modify.',
	},
	'toolPolicy.preset.cautious': {
		message: 'Cautious (default)',
		context: 'Tool permission preset name: agent asks before risky operations. This is the default.',
	},
	'toolPolicy.preset.editMode': {
		message: 'Edit mode',
		context: 'Tool permission preset name: agent may edit without asking each time.',
	},
	'toolPolicy.preset.yolo': {
		message: 'YOLO mode',
		context:
			'Tool permission preset name: everything auto-approved. "YOLO" is an intentionally informal acronym; keep it as-is.',
	},
	'toolPolicy.preset.custom': {
		message: 'Custom',
		context: 'Tool permission preset name: user-defined per-tool permissions.',
	},
	'toolPolicy.permission.deny': {
		message: 'Deny',
		context: 'Per-tool permission dropdown option: the agent may never use this tool.',
	},
	'toolPolicy.permission.askUser': {
		message: 'Ask user',
		context: 'Per-tool permission dropdown option: the agent must ask before using this tool.',
	},
	'toolPolicy.permission.approve': {
		message: 'Approve',
		context: 'Per-tool permission dropdown option: the tool is auto-approved.',
	},
	'toolPolicy.classification.read': {
		message: 'Read tools',
		context: 'Settings section header grouping tools that only read data.',
	},
	'toolPolicy.classification.write': {
		message: 'Write tools',
		context: 'Settings section header grouping tools that create or modify files.',
	},
	'toolPolicy.classification.destructive': {
		message: 'Destructive tools',
		context: 'Settings section header grouping tools that can delete data.',
	},
	'toolPolicy.classification.external': {
		message: 'External tools',
		context: 'Settings section header grouping tools that reach outside the vault (web, MCP).',
	},
	'command.summarizeActiveFile': {
		message: 'Summarize active file',
		context: 'Command palette entry that generates a one-sentence summary of the open note into its frontmatter.',
	},
	'command.toggleCompletions': {
		message: 'Toggle completions',
		context: 'Command palette entry that turns IDE-style inline text completions on or off.',
	},
	'command.createCustomPrompt': {
		message: 'Create new custom prompt',
		context: 'Command palette entry that creates a new reusable custom prompt template.',
	},
	'notice.rewrite.rewritingSelection': {
		message: 'Rewriting selected text...',
		context: 'Toast notification while the AI rewrites the selected text.',
	},
	'notice.rewrite.selectionDone': {
		message: 'Text rewritten successfully',
		context: 'Toast notification when the AI finishes rewriting the selected text.',
	},
	'notice.rewrite.rewritingFile': {
		message: 'Rewriting entire file...',
		context: 'Toast notification while the AI rewrites the whole file.',
	},
	'notice.rewrite.fileDone': {
		message: 'File rewritten successfully',
		context: 'Toast notification when the AI finishes rewriting the whole file.',
	},
	'validation.temperature.notANumber': {
		message: 'Temperature {value} is not a valid number. Adjusted to {adjusted}.',
		context: 'Warning notice in settings when the temperature sampling parameter is not a number.',
	},
	'validation.temperature.exceedsModelLimit': {
		message: 'Temperature {value} exceeds {model} limit of {max}. Adjusted to {max}.',
		context:
			"Warning notice in settings when temperature is above the selected model's maximum. {model} is a model name.",
	},
	'validation.temperature.outOfRange': {
		message: 'Temperature {value} is outside valid range [{min}, {max}]. Adjusted to {adjusted}.',
		context: 'Warning notice in settings when temperature is outside the allowed range.',
	},
	'validation.topP.notANumber': {
		message: 'Top P {value} is not a valid number. Adjusted to {adjusted}.',
		context: 'Warning notice in settings when the Top P sampling parameter is not a number.',
	},
	'validation.topP.outOfRange': {
		message: 'Top P {value} is outside valid range [{min}, {max}]. Adjusted to {adjusted}.',
		context: 'Warning notice in settings when Top P is outside the allowed range.',
	},
	'agent.planMode.toggleAria': {
		message: 'Toggle Plan Mode — review a plan before the agent executes',
		context: 'Accessibility label for the Plan Mode toggle button in the agent send bar.',
	},
	'agent.planMode.headerLabel': {
		message: 'Agent (Plan)',
		context: 'Role label on a plan message in the agent chat. Distinguishes the plan from a regular agent reply.',
	},
	'agent.planMode.approveBtn': {
		message: 'Approve & Execute',
		context: 'Button that accepts the agent-generated plan and starts tool execution.',
	},
	'agent.planMode.rejectBtn': {
		message: 'Reject',
		context: 'Button that dismisses the agent-generated plan without executing anything.',
	},
	'agent.planMode.rejectedNotice': {
		message: 'Plan rejected.',
		context: 'Brief notice shown after the user clicks Reject on an agent plan.',
	},
	'agent.planMode.proceedMessage': {
		message: 'Proceed with the approved plan.',
		context:
			'Synthetic user message automatically sent after the user approves a plan, triggering the agent execution loop. Not user-typed.',
	},
	'agent.planMode.planLabel': {
		message: 'Plan',
		context: 'Short label shown in the role header of a plan entry when reloaded from session history.',
	},
} as const satisfies Record<string, SourceString>;

export type TranslationKey = keyof typeof en;

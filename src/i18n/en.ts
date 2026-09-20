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
	'agent.empty.initContextFailed': {
		message: 'Failed to initialize vault context',
		context:
			'Error notice shown when the "Initialize vault context" empty-state button fails to analyze the vault (e.g. an API error).',
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
	'settings.general.providerOptionGemini': {
		message: 'Google Gemini (cloud)',
		context: 'Dropdown option label for the Google Gemini cloud provider. "Google Gemini" is a product name.',
	},
	'settings.general.providerOptionOllama': {
		message: 'Ollama',
		context:
			'Dropdown option label for the Ollama provider. Not qualified as "local": Ollama serves models pulled to this machine and can also proxy to Ollama cloud models. "Ollama" is a product name.',
	},
	'settings.general.providerOptionOpenai': {
		message: 'OpenAI (cloud)',
		context:
			'Dropdown option label for the OpenAI cloud provider (also used for OpenAI-compatible local servers via a custom base URL). "OpenAI" is a product name.',
	},
	'settings.general.providerOptionAnthropic': {
		message: 'Anthropic (cloud)',
		context: 'Dropdown option label for the Anthropic (Claude) cloud provider. "Anthropic" is a product name.',
	},
	'settings.general.modelListUpdated': {
		message: 'Model list updated: {count} models.',
		context: 'Notice after a successful Gemini model list refresh. {count} is the number of models (0 or 2+).',
	},
	'settings.general.modelListUpdatedSingular': {
		message: 'Model list updated: {count} model.',
		context:
			'Notice after a successful Gemini model list refresh when exactly one model is available. {count} is the number 1.',
	},
	'settings.general.refreshSkippedOffline': {
		message: 'Skipped: offline',
		context: 'Notice when a model list refresh was skipped because the device is offline.',
	},
	'settings.general.refreshSkippedNotGemini': {
		message: 'Skipped: no feature is set to use Gemini',
		context:
			'Notice when a Gemini model list refresh was skipped because no feature is routed to the Gemini provider, so the list would go unused.',
	},
	'settings.general.refreshModelListFailed': {
		message: 'Failed to refresh model list: {error}',
		context: 'Notice when fetching the latest Gemini model list fails. {error} is the error message.',
	},
	'settings.main.groupChat': {
		message: 'Chat',
		context: 'Heading for the "Chat" group of rows on the top-level settings tab.',
	},
	'settings.main.groupVault': {
		message: 'Vault',
		context:
			'Heading for the "Vault" group of rows on the top-level settings tab. "Vault" is the Obsidian term for a notes folder.',
	},
	'settings.main.groupAutomation': {
		message: 'Automation',
		context: 'Heading for the "Automation" group of rows on the top-level settings tab.',
	},
	'settings.main.providersName': {
		message: 'Providers',
		context: 'Top-level settings row opening the Providers sub-page (connection cards for Gemini, Ollama, OpenAI).',
	},
	'settings.main.yourNameName': {
		message: 'Your name',
		context: 'Settings field name for the user name input used to personalize AI responses.',
	},
	'settings.main.yourNameDesc': {
		message: 'Your name used in system instructions so the AI can address you personally in conversations.',
		context: 'Settings field description for the user name input.',
	},
	'settings.main.keepSessionHistoryName': {
		message: 'Keep session history',
		context: 'Settings toggle name for persisting agent chat sessions to disk.',
	},
	'settings.main.keepSessionHistoryDesc': {
		message:
			'Persist agent chat sessions as markdown files in your vault. Sessions are saved under Agent-Sessions/ with auto-generated titles.',
		context:
			'Settings toggle description. "Agent-Sessions/" is a literal folder name and must stay untranslated. "Vault" is the Obsidian term for a notes folder.',
	},
	'settings.main.reviewDiffName': {
		message: 'Review a diff before files are written',
		context: 'Settings toggle name. A diff view shows proposed file changes side by side.',
	},
	'settings.main.reviewDiffDesc': {
		message:
			'Automatically open a diff view when the agent proposes file changes, instead of requiring a button click.',
		context: 'Settings toggle description for automatically opening the diff view.',
	},
	'settings.main.vaultSearchIndexName': {
		message: 'Vault search index',
		context: 'Top-level settings row opening the Vault search index sub-page (Google File Search configuration).',
	},
	'settings.main.pluginFolderName': {
		message: 'Plugin folder',
		context: 'Settings field name for the vault folder where the plugin stores its data.',
	},
	'settings.main.pluginFolderDesc': {
		message:
			'Folder where plugin data is stored. Agent sessions live under Agent-Sessions/, custom prompts under Prompts/, hooks under Hooks/, scheduled task state under Scheduled-Tasks/.',
		context:
			'Settings field description for the plugin state folder. The folder names ending in / are literal subfolder names and must stay untranslated.',
	},
	'settings.main.scheduledTasksName': {
		message: 'Scheduled tasks',
		context: 'Top-level settings row opening the Scheduled tasks sub-page.',
	},
	'settings.main.lifecycleHooksName': {
		message: 'Lifecycle hooks',
		context: 'Top-level settings row opening the Lifecycle hooks sub-page.',
	},
	'settings.main.mcpServersName': {
		message: 'MCP servers',
		context:
			'Top-level settings row opening the MCP servers sub-page. "MCP" (Model Context Protocol) is a proper noun/acronym and should stay untranslated.',
	},
	'settings.main.toolPermissionsName': {
		message: 'Tool permissions',
		context: 'Top-level settings row opening the Tool permissions sub-page.',
	},
	'settings.main.advancedName': {
		message: 'Advanced',
		context: 'Top-level settings row opening the Advanced sub-page.',
	},
	'settings.main.documentationName': {
		message: 'Documentation',
		context: 'Settings field name for the row linking to plugin documentation.',
	},
	'settings.main.documentationDesc': {
		message: 'View the complete plugin documentation and guides',
		context: 'Settings field description for the documentation link row.',
	},
	'settings.features.pageName': {
		message: 'Features',
		context: 'Title of the Features settings sub-page, where each AI capability is routed to a provider and model.',
	},
	'settings.features.groupText': {
		message: 'Text',
		context: 'Heading for the "Text" group of rows on the Features settings page.',
	},
	'settings.features.groupTextDesc': {
		message: 'Chat and agent, summaries, completions, and rewrite.',
		context: 'Description under the "Text" group heading on the Features settings page.',
	},
	'settings.features.groupWeb': {
		message: 'Web and research',
		context: 'Heading for the "Web and research" group of rows on the Features settings page.',
	},
	'settings.features.groupWebDesc': {
		message: 'Web search, deep research, and the vault search index.',
		context: 'Description under the "Web and research" group heading on the Features settings page.',
	},
	'settings.features.groupMedia': {
		message: 'Media',
		context: 'Heading for the "Media" group of rows on the Features settings page.',
	},
	'settings.features.provider': {
		message: 'Provider',
		context: 'Label for the provider dropdown on a Features sub-page (e.g. the page for the Chat feature).',
	},
	'settings.features.model': {
		message: 'Model',
		context: 'Label for the model dropdown on a Features sub-page.',
	},
	'settings.features.modelDefault': {
		message: 'Default for this provider',
		context:
			'Model dropdown option meaning "use the provider\'s own default model for this feature" rather than a specific named model.',
	},
	'settings.features.modelDefaultNamed': {
		message: 'Default ({model})',
		context:
			'Model dropdown option meaning "use the provider\'s own default model for this feature", naming that model. {model} is a model display name such as "Claude Opus 5" and stays untranslated.',
	},
	'settings.features.sameAsChat': {
		message: 'Same as chat',
		context:
			'Model dropdown option meaning this feature uses whatever model the Chat feature is using, for a provider that keeps one model resident.',
	},
	'settings.features.modelMissing': {
		message: 'No longer available',
		context:
			"Label appended to a model option that is stored in settings but no longer present in the provider's current model list.",
	},
	'settings.features.off': {
		message: 'Off',
		context: 'Displayed value for a Feature row that is deliberately not routed to any provider.',
	},
	'settings.features.chooseProvider': {
		message: 'Choose a provider',
		context: 'Displayed value / prompt for a Feature row whose stored provider can no longer serve that feature.',
	},
	'settings.features.notConnected': {
		message: 'not connected',
		context:
			'Part of a Feature row\'s displayed value, e.g. "OpenAI · not connected", when the routed provider is missing credentials.',
	},
	'settings.features.deepResearchAgent': {
		message: 'Deep Research agent',
		context: 'Displayed value for the Deep research feature, which has no separate model setting of its own.',
	},
	'settings.features.fileSearch': {
		message: 'Google File Search',
		context:
			'Displayed value for the Vault search index feature, which has no separate model setting of its own. "Google File Search" is a product name.',
	},
	'settings.features.label.chat': {
		message: 'Chat and agent',
		context: 'Feature row label on the Features settings page for the chat/agent conversation feature.',
	},
	'settings.features.label.summary': {
		message: 'Summaries',
		context: 'Feature row label on the Features settings page for the note-summarization feature.',
	},
	'settings.features.label.completions': {
		message: 'Completions',
		context: 'Feature row label on the Features settings page for the inline text-completion feature.',
	},
	'settings.features.label.rewrite': {
		message: 'Rewrite',
		context: 'Feature row label on the Features settings page for the text-rewrite feature.',
	},
	'settings.features.label.webSearch': {
		message: 'Web search',
		context: 'Feature row label on the Features settings page for the web search / page fetch feature.',
	},
	'settings.features.label.deepResearch': {
		message: 'Deep research',
		context: 'Feature row label on the Features settings page for the Deep Research agent feature.',
	},
	'settings.features.label.rag': {
		message: 'Vault search index',
		context: 'Feature row label on the Features settings page for the semantic vault search feature.',
	},
	'settings.features.label.imageGen': {
		message: 'Image generation',
		context: 'Feature row label on the Features settings page for the image-generation feature.',
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
		message: 'Rescan vault',
		context: 'Button in the RAG status modal that rescans the vault for changed files.',
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
			'Command palette id to fire. Examples: editor:save-file, gemini-scribe:summarize-active-file. View command IDs via Settings → Hotkeys (open the developer console with Ctrl+Shift+I to inspect ids).',
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
		message: 'Rescan complete: {indexed} re-indexed, {skipped} unchanged',
		context: 'Notice when a vault rescan finishes. {indexed} and {skipped} are counts.',
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
	'agent.tokens.usageThoughts': {
		message: 'Tokens: ~{used} / {limit} ({percent}%) · {thoughts} reasoning',
		context:
			'Token usage indicator variant when the model reports reasoning (thinking) tokens for the last response. {thoughts} is the formatted reasoning-token count. Keep the middle-dot separator.',
	},
	'agent.tokens.usageCachedThoughts': {
		message: 'Tokens: ~{used} / {limit} ({percent}%) · {cached}% cached · {thoughts} reasoning',
		context:
			'Token usage indicator variant when the prompt was partly served from cache AND the model reported reasoning tokens. {cached} is the cached percentage, {thoughts} the formatted reasoning-token count. Keep the middle-dot separators.',
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
	'agent.header.tooltipPrompt': {
		message: 'Prompt: {value}',
		context: 'Line in the session-settings badge tooltip. {value} is the name of a custom prompt template.',
	},
	'agent.header.promptBadgeFallback': {
		message: 'Custom',
		context:
			'Label shown on the session prompt badge (and in its tooltip) when the configured prompt template path has no usable file name.',
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
	'agent.loop.notice': {
		message: 'The agent is repeating the same "{tool}" call — it may be stuck.',
		context:
			'Transient notice the first time the tool loop detector blocks a repeated identical tool call in a session. {tool} is the tool name (e.g. "read_file"); keep it untranslated.',
	},
	'agent.planMode.approved': {
		message: 'Approved',
		context: 'Non-interactive state badge shown on a plan message after the user approved the plan.',
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
		context:
			'Inline confirmation prompt shown in the session row before deleting a session. {title} is the session title.',
	},
	'agent.sessionList.deleteConfirmAction': {
		message: 'Delete',
		context: 'Label on the button that confirms deleting a session, next to the inline confirmation prompt.',
	},
	'agent.sessionList.deleteCancel': {
		message: 'Cancel',
		context: 'Label on the button that dismisses the inline session-delete confirmation without deleting.',
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
		context: 'Command palette entry that opens the scheduled task manager on its task list.',
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
		context:
			'Command palette entry that reopens the most recent agent session linked to a chosen project (opens the only project directly when just one exists).',
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
	'notice.main.noApiKeyOpenai': {
		message:
			'No OpenAI API key configured. Open Settings → Gemini Scribe to add one. Get a key at platform.openai.com/api-keys',
		context: 'Error notice when the user has not configured an OpenAI API key yet (OpenAI is the primary provider).',
	},
	'notice.main.noApiKeyAnthropic': {
		message:
			'No Anthropic API key configured. Open Settings → Gemini Scribe to add one. Get a key at platform.claude.com/settings/keys',
		context:
			'Error notice when the user has not configured an Anthropic API key yet (Anthropic serves chat). "Gemini Scribe" is the plugin name and stays untranslated.',
	},
	'notice.main.apiKeyRetrieveFailed': {
		message:
			'Could not retrieve your API key from secure storage. Try re-entering it in Settings → Gemini Scribe → Providers → Google Gemini → API key.',
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
	'notice.main.resumeProjectSessionFailed': {
		message: 'Failed to resume project session',
		context: 'Error notice shown when resuming the most recent session for a project fails.',
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
	'notice.main.imageGenUnavailableProvider': {
		message:
			'No provider is set up for image generation. Choose one under Settings → Gemini Scribe → Features → Image generation.',
		context:
			'Notice when the Generate Image command is used but the provider serving image generation does not support it (e.g. a local-only setup). Keep the settings path recognizable to users of the translated UI.',
	},
	'notice.main.imageGenUnavailable': {
		message: 'Image generation is not available.',
		context: 'Notice when the image generation service is not initialized.',
	},
	'notice.main.ragUnavailableProvider': {
		message:
			'No provider is set up for the vault search index. Choose one under Settings → Gemini Scribe → Vault → Vault search index.',
		context:
			'Notice when a RAG (vault search index) command is used but the provider serving RAG does not support it (e.g. a local-only setup). Keep the settings path recognizable to users of the translated UI.',
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
		message:
			'Lowercase identifier used as the filename and in output paths: lowercase letters, digits, and single hyphens (no leading/trailing or consecutive hyphens), 1–64 characters. Cannot be changed after creation.',
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
		message: 'Rescan complete: {indexed} re-indexed, {skipped} unchanged',
		context: 'Toast notification when vault rescan finishes. {indexed} and {skipped} are file counts.',
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
	'agent.planMode.toggleAria': {
		message: 'Toggle Plan Mode — review a plan before the agent executes',
		context: 'Accessibility label for the Plan Mode toggle button in the agent send bar.',
	},
	'agent.planMode.label': {
		message: 'Plan',
		context:
			'Short label revealed on the Plan Mode toggle button when the mode is active. Sits next to a checklist icon in the agent send bar.',
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

	// Turn-path and provider-client messages (src/agent/, src/ui/agent-view/, src/services/,
	// src/api/providers/). These reach the user as a rendered chat message, a modal body, or a
	// thrown Error surfaced through the notice path — unlike the model-facing summarization and
	// tool-prompt strings in the same modules, which deliberately stay English.
	'agent.loopAborted': {
		message:
			'The agent kept retrying the same tool call (loop detector fired {count} times). Stopping this turn to prevent a runaway loop. Try rephrasing your request or starting a new session.',
		context:
			"Chat message shown in place of the agent's answer when the tool-loop detector aborted the turn. {count} is how many times the detector fired (3 or more).",
	},
	'agent.emptyResponseFallback.withTools': {
		message:
			'I completed the requested actions ({tools}) but had trouble generating a summary. The operations were successful.',
		context:
			"Chat message spoken in the agent's own voice when tools ran successfully but the model returned no summary text, even after a retry. {tools} is a comma-separated list of the tool display names that ran.",
	},
	'agent.emptyResponseFallback.noTools': {
		message: 'I completed the requested actions but had trouble generating a summary. The operations were successful.',
		context:
			"Same as agent.emptyResponseFallback.withTools, but used when no tool name could be listed. Spoken in the agent's own voice.",
	},
	'selection.emptyResponse': {
		message: 'The AI returned an empty response. Please try again.',
		context:
			'Error text in the response modal after running a selection action (summarize, rewrite, …) when the model returned nothing.',
	},
	'provider.openai.noModelSelected': {
		message: 'No OpenAI model selected. Choose a model in settings.',
		context:
			'Error shown when an OpenAI-routed feature runs with no model configured. "settings" is Obsidian\'s settings window.',
	},
	'provider.unsupportedAttachment': {
		message:
			'{provider} only supports image attachments; received {mimeType}. Switch to the Gemini provider for PDF, audio, or video input.',
		context:
			'Error shown when a non-image attachment is sent to a provider that only accepts images. {provider} is a provider name (OpenAI / Ollama) and stays untranslated; {mimeType} is a MIME type such as "application/pdf". "Gemini" is a provider name and stays untranslated.',
	},
	'provider.anthropic.noModelSelected': {
		message: 'No Anthropic model selected. Choose a model in settings.',
		context:
			'Error shown when an Anthropic-routed feature runs with no model configured. "settings" is Obsidian\'s settings window.',
	},
	'provider.unsupportedAttachmentPdf': {
		message:
			'{provider} only supports image and PDF attachments; received {mimeType}. Switch to the Gemini provider for audio or video input.',
		context:
			'Error shown when an attachment that is neither an image nor a PDF is sent to a provider that accepts both. {provider} is a provider name (Anthropic) and stays untranslated; {mimeType} is a MIME type such as "audio/mpeg". "Gemini" is a provider name and stays untranslated.',
	},
	'provider.unsupportedAttachmentInHistory': {
		message:
			'{provider} only supports image attachments; conversation history contains {mimeType}. Switch to the Gemini provider for PDF, audio, or video input.',
		context:
			'Same as provider.unsupportedAttachment, but the offending attachment came from earlier in the conversation rather than the current message. {provider} and "Gemini" are provider names and stay untranslated; {mimeType} is a MIME type.',
	},
	'provider.unsupportedAttachmentInHistoryPdf': {
		message:
			'{provider} only supports image and PDF attachments; conversation history contains {mimeType}. Switch to the Gemini provider for audio or video input.',
		context:
			'Same as provider.unsupportedAttachmentPdf, but the offending attachment came from earlier in the conversation rather than the current message. {provider} and "Gemini" are provider names and stay untranslated; {mimeType} is a MIME type.',
	},
	'provider.gemini.noImageData': {
		message: 'No image data in response. The model may have returned only text.',
		context: 'Error shown when an image-generation request to Gemini came back without any image payload.',
	},

	// Model API error guidance (src/utils/error-utils.ts). These sentences are shown to users —
	// sometimes interpolated into a longer notice, sometimes as the entire notice. Several are
	// near-identical in English, so each context names the condition that produces it.
	'error.unknown': {
		message: 'An unknown error occurred',
		context: 'Shown when the failure carried no error value at all (null/undefined).',
	},
	'error.openaiInvalidKey': {
		message: 'Invalid OpenAI API key. Please check the API key in Settings → Gemini Scribe.',
		context:
			'HTTP 401 from an OpenAI-compatible provider. "Gemini Scribe" is the plugin name and stays untranslated; "Settings" is Obsidian\'s settings window.',
	},
	'error.anthropicInvalidKey': {
		message: 'Invalid Anthropic API key. Please check the API key in Settings → Gemini Scribe.',
		context:
			'HTTP 401 from the Anthropic API. "Gemini Scribe" is the plugin name and stays untranslated; "Settings" is Obsidian\'s settings window.',
	},
	'error.modelNotOnEndpoint': {
		message: 'Model not available on this endpoint. Please check your model settings or the configured base URL.',
		context:
			'HTTP 404 from an OpenAI-compatible provider: the server is reachable but does not serve the selected model. "Base URL" is the server address the user configured.',
	},
	'error.serverUnreachable': {
		message:
			'Could not connect to the model server. If you configured a custom base URL (LM Studio, MLX, etc.), make sure the server is running and the base URL in settings is correct.',
		context:
			'The OpenAI-compatible client could not open a connection at all. "LM Studio" and "MLX" are product names and stay untranslated.',
	},
	'error.invalidApiKey': {
		message: 'Invalid API key. Please check your model provider credentials in settings.',
		context: 'The provider rejected the configured API key. Generic across providers.',
	},
	'error.authFailed': {
		message:
			'Authentication failed. Please verify your model provider credentials and that your account has access to this model.',
		context:
			'The credentials were accepted but the account lacks permission for this model (forbidden/unauthorized), as opposed to the key itself being invalid.',
	},
	'error.quotaExhausted': {
		message:
			'Free-tier quota exhausted for this model. Try switching to a different model (e.g., Gemini Flash) or enable billing in Google AI Studio.',
		context:
			'Permanent quota exhaustion — retrying will not help. "Gemini Flash" and "Google AI Studio" are product names and stay untranslated.',
	},
	'error.rateLimit': {
		message: 'API rate limit exceeded. Please wait a moment and try again.',
		context: 'Transient rate limiting, detected from the error message rather than an HTTP status code.',
	},
	'error.ollamaModelNotPulled': {
		message: 'Ollama model not pulled. Run: ollama pull {model}',
		context:
			'The local Ollama server does not have the model downloaded yet. "ollama pull {model}" is a shell command and must stay verbatim; {model} is the model name.',
	},
	'error.modelNotAvailable': {
		message: 'The selected model is not available. Please check your model settings.',
		context: 'The provider reported the model does not exist, with no provider-specific remedy to offer.',
	},
	'error.ollamaUnreachable': {
		message:
			'Could not connect to the Ollama daemon. Make sure `ollama serve` is running and the base URL in settings is correct.',
		context:
			'A network failure that looks like it targeted a local Ollama endpoint. "ollama serve" is a shell command and must stay verbatim.',
	},
	'error.network': {
		message: 'Network error: Unable to reach the model API. Please check your connection.',
		context: 'A generic connectivity failure that was not attributable to a specific provider.',
	},
	'error.timeout': {
		message: 'Request timed out. The API took too long to respond. Please try again.',
		context: 'The request was abandoned after the provider took too long, detected from the error message.',
	},
	'error.serviceUnavailable': {
		message: 'The model API is temporarily unavailable. Please try again later.',
		context: 'A provider-side outage detected from the error message rather than an HTTP status code.',
	},
	'error.safetyBlocked': {
		message: 'Content was blocked by safety filters. Please rephrase your request.',
		context: "The provider's content-safety filters rejected the request or the response.",
	},
	'error.tokenLimit': {
		message: 'Request exceeds token limit. Please reduce the length of your message or conversation history.',
		context:
			'The prompt plus conversation history exceeded the model\'s context window. "Token" is the standard LLM unit of text.',
	},
	'error.apiPrefix': {
		message: 'API error: {message}',
		context:
			'Wrapper around a provider error we could not classify. {message} is the provider\'s own text and arrives in English; only the "API error" prefix is translated.',
	},
	'error.communicationFailed': {
		message: 'An error occurred while communicating with the model API',
		context: 'Fallback for an error object that carried no usable message at all.',
	},
	'error.unknownCommunication': {
		message: 'An unknown error occurred while communicating with the model API',
		context: 'Last-resort fallback when nothing about the error value could be interpreted.',
	},
	'error.http.badRequest': {
		message: 'Bad request: The API request was invalid. Please check your message and try again.',
		context: 'HTTP 400 from the model API.',
	},
	'error.http.unauthorized': {
		message: 'Authentication failed: Invalid API key. Please check your model provider credentials in settings.',
		context: 'HTTP 401 from the model API.',
	},
	'error.http.forbidden': {
		message: 'Access forbidden: The model provider denied access to this model or feature.',
		context: 'HTTP 403 from the model API.',
	},
	'error.http.notFound': {
		message: 'Model not found: The selected model is not available. Please check your model settings.',
		context: 'HTTP 404 from the model API.',
	},
	'error.http.rateLimit': {
		message: 'Rate limit exceeded: Too many requests. Please wait a moment and try again.',
		context: 'HTTP 429 from the model API, for transient rate limiting rather than exhausted quota.',
	},
	'error.http.serverError': {
		message: 'Server error: The model API encountered an internal error. Please try again later.',
		context: 'HTTP 500 from the model API.',
	},
	'error.http.serviceUnavailable': {
		message: 'Service unavailable: The model API is temporarily down. Please try again later.',
		context: 'HTTP 503 from the model API.',
	},
	'error.http.gatewayTimeout': {
		message: 'Gateway timeout: The API request took too long. Please try again.',
		context: 'HTTP 504 from the model API.',
	},
	'error.http.serverErrorWithCode': {
		message: 'Server error ({statusCode}): The model API is experiencing issues. Please try again later.',
		context: 'Any other 5xx status. {statusCode} is the numeric HTTP status code.',
	},
	'error.http.clientErrorWithCode': {
		message: 'Client error ({statusCode}): {message}',
		context:
			"Any other 4xx status where the provider supplied detail text. {statusCode} is the numeric HTTP status; {message} is the provider's own text and arrives in English.",
	},
	'error.http.clientErrorWithCodeNoDetail': {
		message: 'Client error ({statusCode}): Please check your request and try again.',
		context:
			'Any other 4xx status where the provider supplied no detail text. {statusCode} is the numeric HTTP status.',
	},
	'error.http.genericWithCode': {
		message: 'HTTP error {statusCode}: {message}',
		context:
			"A non-4xx, non-5xx status carrying detail text. {statusCode} is the numeric HTTP status; {message} is the provider's own text and arrives in English.",
	},
	'error.http.genericWithCodeNoDetail': {
		message: 'HTTP error {statusCode}: An unexpected error occurred.',
		context: 'A non-4xx, non-5xx status with no detail text. {statusCode} is the numeric HTTP status.',
	},

	// -- Advanced page --
	'settings.advanced.compactionThresholdName': {
		message: 'Context compaction threshold',
		context: 'Slider label on the Advanced settings sub-page.',
	},
	'settings.advanced.compactionThresholdDesc': {
		message: 'Older turns are summarized once the context window reaches this percentage full.',
		context: 'Description under the context-compaction-threshold slider on the Advanced settings sub-page.',
	},
	'settings.advanced.stopOnToolErrorName': {
		message: 'Stop the agent when a tool fails',
		context: 'Toggle label on the Advanced settings sub-page.',
	},
	'settings.advanced.stopOnToolErrorDesc': {
		message: 'When off, the agent keeps going after a tool call fails instead of ending the turn.',
		context: 'Description under the "Stop the agent when a tool fails" toggle.',
	},
	'settings.advanced.summaryFrontmatterKeyName': {
		message: 'Summary frontmatter key',
		context:
			'Text field label on the Advanced settings sub-page; controls which frontmatter key note summaries are written to.',
	},
	'settings.advanced.summaryFrontmatterKeyDesc': {
		message: "The frontmatter property name used to store a note's generated summary.",
		context: 'Description under the summary-frontmatter-key text field.',
	},
	'settings.advanced.logToolExecutionName': {
		message: 'Record tool calls in session history',
		context: 'Toggle label on the Advanced settings sub-page.',
	},
	'settings.advanced.logToolExecutionDesc': {
		message: 'Requires session history to be enabled.',
		context: 'Description under the "Record tool calls in session history" toggle, explaining why it may be disabled.',
	},
	'settings.advanced.diagnosticsHeading': {
		message: 'Diagnostics',
		context: 'Group heading on the Advanced settings sub-page.',
	},
	'settings.advanced.debugModeName': {
		message: 'Debug mode',
		context: 'Toggle label on the Advanced settings sub-page.',
	},
	'settings.advanced.debugModeDesc': {
		message: 'Logs extra detail to the developer console to help diagnose issues.',
		context: 'Description under the debug-mode toggle.',
	},
	'settings.advanced.showTokenUsageName': {
		message: 'Show token usage',
		context: 'Toggle label on the Advanced settings sub-page.',
	},
	'settings.advanced.showTokenUsageDesc': {
		message: 'Displays the token count for each message in the agent view.',
		context: 'Description under the show-token-usage toggle.',
	},
	'settings.advanced.logToFileName': {
		message: 'Log API calls to a file',
		context: 'Toggle label on the Advanced settings sub-page.',
	},
	'settings.advanced.logToFileDesc': {
		message: 'Writes every model API request and response to a log file in the plugin folder.',
		context: 'Description under the "Log API calls to a file" toggle.',
	},

	// -- Scheduled tasks / Lifecycle hooks pages (Automation group) --
	'settings.automation.manageScheduledTasksName': {
		message: 'Manage scheduled tasks',
		context: 'Action row label on the Scheduled tasks settings sub-page; opens the scheduler management modal.',
	},
	'settings.automation.manageScheduledTasksDesc': {
		message: 'View, edit, and run your scheduled agent tasks.',
		context: 'Description under "Manage scheduled tasks".',
	},
	'settings.automation.newTaskName': {
		message: 'New scheduled task',
		context: 'Action row label on the Scheduled tasks settings sub-page; opens the scheduler modal in create mode.',
	},
	'settings.automation.newTaskDesc': {
		message: 'Create a new scheduled task.',
		context: 'Description under "New scheduled task".',
	},
	'settings.automation.autoRunCatchUpName': {
		message: 'Auto-run missed tasks on startup',
		context: 'Toggle label on the Scheduled tasks settings sub-page.',
	},
	'settings.automation.autoRunCatchUpDesc': {
		message: "When Obsidian was closed at a task's scheduled time, run it automatically the next time the vault opens.",
		context: 'Description under "Auto-run missed tasks on startup".',
	},
	'settings.automation.taskCount': {
		message: '{count} tasks',
		context:
			'Displayed-value summary on the Scheduled tasks page-link row, for a count other than 1. {count} is the number of scheduled tasks.',
	},
	'settings.automation.taskCountSingular': {
		message: '{count} task',
		context: 'Displayed-value summary on the Scheduled tasks page-link row, for exactly 1 task.',
	},
	'settings.automation.enableHooksName': {
		message: 'Enable lifecycle hooks',
		context: "Toggle label on the Lifecycle hooks settings sub-page; the page's first row.",
	},
	'settings.automation.enableHooksDesc': {
		message: 'Let the AI run automatically in response to vault events, like a file being created or modified.',
		context: 'Description under "Enable lifecycle hooks".',
	},
	'settings.automation.manageHooksName': {
		message: 'Manage hooks',
		context: 'Action row label on the Lifecycle hooks settings sub-page; opens the hook management modal.',
	},
	'settings.automation.manageHooksDesc': {
		message: 'View, edit, and run your lifecycle hooks.',
		context: 'Description under "Manage hooks".',
	},
	'settings.automation.newHookName': {
		message: 'New hook',
		context: 'Action row label on the Lifecycle hooks settings sub-page; opens the hook modal in create mode.',
	},
	'settings.automation.newHookDesc': {
		message: 'Create a new lifecycle hook.',
		context: 'Description under "New hook".',
	},
	'settings.automation.hooksStatusOn': {
		message: 'On',
		context: 'Displayed-value summary on the Lifecycle hooks page-link row when hooks are enabled.',
	},
	'settings.automation.hooksStatusOff': {
		message: 'Off',
		context: 'Displayed-value summary on the Lifecycle hooks page-link row when hooks are disabled.',
	},
	'settings.automation.openHookManagerFailed': {
		message: 'Failed to open the hook manager: {error}',
		context: 'Notice shown when the lifecycle hook management modal fails to load. {error} is the failure detail.',
	},
	'settings.automation.openSchedulerFailed': {
		message: 'Failed to open the scheduler: {error}',
		context: 'Notice shown when the scheduled task management modal fails to load. {error} is the failure detail.',
	},

	// -- MCP servers page --
	'settings.mcp.noServers': {
		message: 'No MCP servers configured yet.',
		context: 'Empty-state text for the MCP servers list on the MCP servers settings sub-page.',
	},
	'settings.mcp.addServerButton': {
		message: 'Add MCP server',
		context: 'Tooltip/mobile-row label for the add-item affordance on the MCP servers list.',
	},
	'settings.mcp.editButton': {
		message: 'Edit',
		context: 'Tooltip for the per-row edit button on the MCP servers settings sub-page.',
	},
	'settings.mcp.httpUrl': {
		message: 'URL: {url}',
		context:
			"Part of an MCP server row's description for an HTTP-transport server. {url} is the server's endpoint URL.",
	},
	'settings.mcp.authorized': {
		message: 'Authorized',
		context: "Part of an MCP server row's description when an OAuth token is present for that server.",
	},
	'settings.mcp.duplicateServerName': {
		message: 'A server named "{name}" already exists.',
		context:
			'Notice shown when adding or renaming an MCP server to a name already in use. {name} is the conflicting server name.',
	},
	'settings.mcp.reconnectFailed': {
		message: 'Saved, but reconnecting to "{name}" failed: {error}',
		context:
			'Notice shown when an MCP server edit saves successfully but the reconnect attempt fails. {name} is the server name, {error} the failure detail.',
	},
	'settings.mcp.openEditorFailed': {
		message: 'Failed to open the MCP server editor: {error}',
		context: 'Notice shown when the MCP server edit modal fails to load. {error} is the failure detail.',
	},
	'settings.mcp.openAddDialogFailed': {
		message: 'Failed to open the add-server dialog: {error}',
		context: 'Notice shown when the MCP add-server modal fails to load. {error} is the failure detail.',
	},
	'settings.mcp.savedButConnectFailed': {
		message: 'Saved, but connecting to the server failed: {error}',
		context:
			'Notice shown when a newly-added MCP server saves successfully but the initial connection attempt fails. {error} is the failure detail.',
	},
	'settings.mcp.serverCount': {
		message: '{count} servers',
		context:
			'Displayed-value summary on the MCP servers page-link row, for a count other than 1. {count} is the number of configured servers.',
	},
	'settings.mcp.serverCountSingular': {
		message: '{count} server',
		context: 'Displayed-value summary on the MCP servers page-link row, for exactly 1 configured server.',
	},

	// -- Vault search index page --
	'settings.rag.privacyNoticeName': {
		message: 'Privacy',
		context: 'Row heading introducing the privacy notice on the Vault search index settings sub-page.',
	},
	'settings.rag.privacyNotice': {
		message:
			'Indexing sends note content to Google File Search for semantic search. Excluded folders and attachments never leave your device.',
		context: 'Privacy notice shown on the Vault search index settings sub-page, replacing the old inline banner.',
	},
	'settings.rag.enableName': {
		message: 'Index this vault',
		context: 'Toggle label on the Vault search index settings sub-page.',
	},
	'settings.rag.enableDesc': {
		message: 'Build a searchable semantic index of your notes using Google File Search.',
		context: 'Description under "Index this vault".',
	},
	'settings.rag.statusName': {
		message: 'Status',
		context: 'Row label for the index status/rescan/delete row on the Vault search index settings sub-page.',
	},
	'settings.rag.notYetIndexed': {
		message: 'Not yet indexed.',
		context: 'Status text shown before the vault has been indexed for the first time.',
	},
	'settings.rag.filesIndexed': {
		message: '{count} files indexed.',
		context: 'Status text showing how many files are currently indexed. {count} is the file count.',
	},
	'settings.rag.reindexButton': {
		message: 'Rescan',
		context: 'Button label that re-indexes the vault, on the Vault search index settings sub-page.',
	},
	'settings.rag.indexingButton': {
		message: 'Indexing…',
		context: 'Button label shown while a vault indexing run is in progress.',
	},
	'settings.rag.indexResult': {
		message: 'Indexed {indexed}, skipped {skipped}, failed {failed}.',
		context: 'Notice shown after a vault indexing run completes, summarizing the outcome.',
	},
	'settings.rag.indexingFailed': {
		message: 'Indexing failed: {error}',
		context: 'Notice shown when a vault indexing run throws. {error} is the failure detail.',
	},
	'settings.rag.serviceNotInitialized': {
		message: 'The vault search index service is not initialized yet.',
		context: 'Notice shown when the Rescan or Delete index button is used before the RAG indexing service has started.',
	},
	'settings.rag.deleteIndexButton': {
		message: 'Delete index',
		context: 'Button label that deletes the remote vault search index, on the Vault search index settings sub-page.',
	},
	'settings.rag.deletingButton': {
		message: 'Deleting…',
		context: 'Button label shown while the vault search index is being deleted.',
	},
	'settings.rag.indexDeletedNotice': {
		message: 'Vault search index deleted.',
		context: 'Notice shown after the vault search index is successfully deleted.',
	},
	'settings.rag.deleteIndexFailed': {
		message: 'Failed to delete the vault search index: {error}',
		context: 'Notice shown when deleting the vault search index throws. {error} is the failure detail.',
	},
	'settings.rag.openDeleteConfirmFailed': {
		message: 'Failed to open the delete-index confirmation: {error}',
		context:
			'Notice shown when the RAG cleanup confirmation modal fails to load from the delete-index button. {error} is the failure detail.',
	},
	'settings.rag.storeNameName': {
		message: 'Index name',
		context: 'Row label for the read-only index/store-name row on the Vault search index settings sub-page.',
	},
	'settings.rag.storeNameDescAssigned': {
		message: 'Assigned automatically by Google File Search.',
		context: 'Description under the index-name row once a store has been created.',
	},
	'settings.rag.storeNameDescPending': {
		message: 'Assigned automatically once the vault is first indexed.',
		context: 'Description under the index-name row before a store exists yet.',
	},
	'settings.rag.copyButton': {
		message: 'Copy',
		context: 'Button label that copies the index/store name to the clipboard.',
	},
	'settings.rag.copyTooltip': {
		message: 'Copy the index name to the clipboard',
		context: 'Tooltip for the copy button on the index-name row.',
	},
	'settings.rag.storeNameCopiedNotice': {
		message: 'Index name copied to clipboard.',
		context: 'Notice shown after the index name is copied to the clipboard.',
	},
	'settings.rag.whatGetsIndexedHeading': {
		message: 'What gets indexed',
		context: 'Group heading on the Vault search index settings sub-page.',
	},
	'settings.rag.autoSyncName': {
		message: 'Sync changes automatically',
		context: 'Toggle label under "What gets indexed" on the Vault search index settings sub-page.',
	},
	'settings.rag.autoSyncDesc': {
		message: 'Keep the index up to date as notes are created, edited, and deleted.',
		context: 'Description under "Sync changes automatically".',
	},
	'settings.rag.includeAttachmentsName': {
		message: 'Include attachments',
		context: 'Toggle label under "What gets indexed" on the Vault search index settings sub-page.',
	},
	'settings.rag.includeAttachmentsDesc': {
		message: 'Also index PDFs and other supported attachments, not just notes.',
		context: 'Description under "Include attachments".',
	},
	'settings.rag.excludeFoldersName': {
		message: 'Exclude folders',
		context: 'Textarea label under "What gets indexed" on the Vault search index settings sub-page.',
	},
	'settings.rag.excludeFoldersDesc': {
		message: "One folder path per line. {folders} are always excluded and don't need to be listed.",
		context:
			'Description under the exclude-folders textarea. {folders} is a comma-separated list of the always-excluded system folders.',
	},
	'settings.rag.excludeFoldersPlaceholder': {
		message: 'folder/subfolder',
		context: 'Placeholder text in the exclude-folders textarea.',
	},
	'settings.rag.summaryOn': {
		message: 'On · {count} files',
		context:
			'Displayed-value summary on the Vault search index page-link row when indexing is enabled. {count} is the indexed file count.',
	},
	'settings.rag.summaryOff': {
		message: 'Off',
		context: 'Displayed-value summary on the Vault search index page-link row when indexing is disabled.',
	},

	// -- Tool permissions page --
	'settings.tools.presetName': {
		message: 'Preset',
		context: 'Dropdown label on the Tool permissions settings page.',
	},
	'settings.tools.presetDesc': {
		message: 'Custom appears here once you change a tool below.',
		context: 'Description under the preset dropdown on the Tool permissions settings page.',
	},
	'settings.tools.toolsHeading': {
		message: 'Tools',
		context: 'Group heading for the searchable list of per-tool permission rows on the Tool permissions settings page.',
	},
	'settings.tools.filterPlaceholder': {
		message: 'Filter tools…',
		context: 'Placeholder text for the search box above the tool permission rows.',
	},
	'settings.tools.filterRowName': {
		message: 'Filter by type',
		context:
			'Accessible name for the row of filter pills (All/Read/Write/Destructive/External/MCP) above the tool permission rows; not shown visually.',
	},
	'settings.tools.filterAll': {
		message: 'All',
		context: 'Filter pill label on the Tool permissions settings page: shows every tool.',
	},
	'settings.tools.filterRead': {
		message: 'Read',
		context: 'Filter pill label on the Tool permissions settings page: shows read-classified tools only.',
	},
	'settings.tools.filterWrite': {
		message: 'Write',
		context: 'Filter pill label on the Tool permissions settings page: shows write-classified tools only.',
	},
	'settings.tools.filterDestructive': {
		message: 'Destructive',
		context: 'Filter pill label on the Tool permissions settings page: shows destructive-classified tools only.',
	},
	'settings.tools.filterExternal': {
		message: 'External',
		context: 'Filter pill label on the Tool permissions settings page: shows external-classified tools only.',
	},
	'settings.tools.filterMcp': {
		message: 'MCP',
		context: 'Filter pill label on the Tool permissions settings page: shows only tools contributed by an MCP server.',
	},
	'settings.tools.noToolsName': {
		message: 'No tools registered',
		context: 'Row name shown on the Tool permissions settings page when no tools are registered yet.',
	},
	'settings.tools.noToolsDesc': {
		message: "Tool permissions will appear here once the agent's tools finish loading.",
		context: 'Row description shown on the Tool permissions settings page when no tools are registered yet.',
	},
	'settings.tools.yoloConfirmFailed': {
		message: 'Failed to open the YOLO mode confirmation: {error}',
		context:
			'Notice shown when the YOLO confirmation modal fails to load while switching the tool-permission preset. {error} is the failure detail.',
	},
	'settings.common.listSeparator': {
		message: ' · ',
		context:
			'Separator joining short items into one line (e.g. provider names, feature labels). Middle dot with surrounding spaces; keep as a single glyph appropriate to the target script.',
	},
	'settings.providers.shortLabel.gemini': {
		message: 'Gemini',
		context:
			'Short provider name used in summary lines and dropdowns where "Google Gemini (cloud)" would be too long (e.g. "Gemini · Ollama"). "Gemini" is a product name.',
	},
	'settings.providers.shortLabel.ollama': {
		message: 'Ollama',
		context: 'Short provider name used in summary lines and dropdowns. "Ollama" is a product name.',
	},
	'settings.providers.shortLabel.openai': {
		message: 'OpenAI',
		context: 'Short provider name used in summary lines and dropdowns. "OpenAI" is a product name.',
	},
	'settings.providers.shortLabel.anthropic': {
		message: 'Anthropic',
		context:
			'Short provider name for Anthropic (Claude), used on its provider card and in routing rows. "Anthropic" is a product name.',
	},
	'settings.providers.cardNameGemini': {
		message: 'Google Gemini',
		context: 'Title of the Gemini provider card on the Providers settings page. "Google Gemini" is a product name.',
	},
	'settings.providers.apiKeyName': {
		message: 'API key',
		context: "Row name for a provider card's API key field, backed by a secret-storage control.",
	},
	'settings.providers.apiKeyDesc': {
		message: "Saved in Obsidian's secret storage, not in this vault's data.",
		context: "Row description for a provider card's API key field, reassuring the user how the key is stored.",
	},
	'settings.providers.baseUrlName': {
		message: 'Base URL',
		context: "Row name for a provider card's endpoint/base-URL field.",
	},
	'settings.providers.baseUrlOptionalDesc': {
		message: 'Leave blank to use the default endpoint.',
		context: 'Row description for an optional base-URL field (Gemini, OpenAI).',
	},
	'settings.providers.baseUrlRequiredDesc': {
		message: 'Address of the local server this provider talks to.',
		context: 'Row description for a required base-URL field (Ollama).',
	},
	'settings.providers.baseUrlPlaceholder': {
		message: 'http://localhost:11434',
		context: "Placeholder text for a provider card's base-URL input, showing the Ollama default as an example.",
	},
	'settings.providers.baseUrlInvalid': {
		message: 'Enter a valid URL.',
		context: 'Inline validation error shown under a base-URL field that does not parse as a URL.',
	},
	'settings.providers.modelsHeading': {
		message: 'Models',
		context: 'Group heading on a provider card for the model list / refresh row.',
	},
	'settings.providers.modelsRowName': {
		message: 'Available models',
		context: "Row name for a provider card's model-count-and-refresh row.",
	},
	'settings.providers.refreshButton': {
		message: 'Refresh',
		context: "Button label that re-fetches a provider's model list.",
	},
	'settings.providers.refreshUnreachable': {
		message: 'Could not reach {provider}. Check the endpoint and try again.',
		context:
			'Notice after the user clicks Refresh on a provider card and the model list could not be fetched. {provider} is the provider name (Ollama / OpenAI).',
	},
	'settings.providers.modelsAvailable': {
		message: '{count} available',
		context: 'Model-count summary for a cloud provider (Gemini, OpenAI). {count} is the number of models.',
	},
	'settings.providers.modelsPulledAndCloud': {
		message: '{count} pulled · {cloud} cloud',
		context:
			'Model-count summary for Ollama when some models are Ollama cloud models proxied to ollama.com. {count} is the number of locally pulled models; {cloud} is the number of cloud models.',
	},
	'settings.providers.ollamaCloudModelLabel': {
		message: '{model} (cloud)',
		context:
			'Model dropdown label for an Ollama cloud model, which Ollama forwards to ollama.com instead of running locally. {model} is the model name.',
	},
	'settings.providers.modelsPulled': {
		message: '{count} pulled',
		context:
			'Model-count summary for Ollama, whose models are downloaded ("pulled") to the local machine. {count} is the number of models.',
	},
	'settings.providers.modelsLoading': {
		message: 'Loading…',
		context: "Placeholder shown for a provider card's model count while the first fetch is in flight.",
	},
	'settings.providers.includesHeading': {
		message: 'Includes',
		context:
			'Row name introducing a provider-bound extra capability (e.g. Google Maps grounding) that rides along with the provider rather than being its own routed feature.',
	},
	'settings.providers.includesMaps': {
		message: 'Google Maps grounding',
		context: 'One of the capabilities listed under a provider card\'s "Includes" row. "Google Maps" is a product name.',
	},
	'settings.providers.includesUrlFetch': {
		message: 'Page fetch by URL',
		context: 'One of the capabilities listed under a provider card\'s "Includes" row.',
	},
	'settings.providers.includesNone': {
		message: 'Nothing extra',
		context: 'Value shown under a provider card\'s "Includes" row when the provider has no provider-bound extras.',
	},
	'settings.providers.usedByHeading': {
		message: 'Used by',
		context: 'Row name listing which features currently route to this provider.',
	},
	'settings.providers.usedByNone': {
		message: 'Nothing yet',
		context: 'Value shown under a provider card\'s "Used by" row when no feature currently routes to this provider.',
	},
	'settings.providers.statusConnected': {
		message: 'Connected',
		context: 'Provider connection status: credentials are present and valid.',
	},
	'settings.providers.statusNeedsKey': {
		message: 'Not set up',
		context: 'Provider connection status: the provider requires a key and none is configured.',
	},
	'settings.providers.statusUnreachable': {
		message: 'Unreachable',
		context: 'Provider connection status: the provider was configured but could not be reached.',
	},
	'settings.providers.statusUnknown': {
		message: 'Not checked yet',
		context: 'Provider connection status: no live signal is available yet (e.g. Ollama before its first probe).',
	},
	'settings.providers.defaultProviderName': {
		message: 'Default provider',
		context: 'Row name for the dropdown choosing which provider serves any feature not explicitly routed elsewhere.',
	},
	'settings.providers.defaultProviderDesc': {
		message: 'Used by any feature you have not routed elsewhere.',
		context: 'Row description for the "Default provider" dropdown.',
	},
	'settings.providers.privacyNoticeName': {
		message: 'Privacy',
		context: 'Row name for the single consolidated privacy note on the Providers page.',
	},
	'settings.providers.privacyNoticeDesc': {
		message:
			'Only the providers your features actually use ever receive your content. Ollama keeps requests on this machine, except for models marked "cloud", which it forwards to ollama.com. Gemini, OpenAI, and Anthropic send the request to that company\'s servers.',
		context:
			'The single privacy note on the Providers page, replacing four separate variants from the previous settings layout. "Ollama", "Gemini", "OpenAI", and "Anthropic" are product names.',
	},
	'settings.providers.defaultMoved': {
		message: '{count} features moved to the new default provider.',
		context:
			'Notice shown after changing "Default provider" when one or more features that were on the previous default automatically moved to the new one. {count} is the number of features moved (1 or more).',
	},
	'settings.providers.groupOnProvider': {
		message: '{group} on {provider}',
		context:
			'Fragment of the top-level "Features" row\'s summary value, e.g. "Text on Ollama". {group} is a Features-page group name (Text / Web and research / Media); {provider} is a short provider name (Gemini / Ollama / OpenAI).',
	},
	'settings.features.modelMissingHelp': {
		message: '{model} is no longer available from this provider. Choose another.',
		context:
			"Inline validation error under a Features sub-page's model dropdown when the stored model has fallen out of the provider's current list. {model} is the model's id/name.",
	},
} as const satisfies Record<string, SourceString>;

export type TranslationKey = keyof typeof en;

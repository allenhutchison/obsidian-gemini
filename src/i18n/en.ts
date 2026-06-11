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
		message: 'What can the Agent do?',
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
		message: '📖 Learn more about Agent Mode',
		context: 'Hyperlink to documentation. Keep the leading book emoji. "Agent Mode" is a feature name.',
	},
	'agent.empty.docsLinkAria': {
		message: 'Open Agent Mode documentation in new tab',
		context: 'Accessibility label (aria-label) for the documentation link.',
	},
	'agent.empty.docsOpenFailed': {
		message: 'Failed to open documentation. Please check your browser settings.',
		context: 'Error notice shown when the documentation link cannot be opened.',
	},
	'agent.empty.updateContext': {
		message: 'Update Vault Context',
		context: 'Button label. Clicking asks the AI to refresh its stored summary of the vault.',
	},
	'agent.empty.updateContextDesc': {
		message: 'Refresh my understanding of your vault',
		context:
			'Button description under "Update Vault Context". "My" refers to the AI agent speaking about its own understanding.',
	},
	'agent.empty.initContext': {
		message: 'Initialize Vault Context',
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
} as const satisfies Record<string, SourceString>;

export type TranslationKey = keyof typeof en;

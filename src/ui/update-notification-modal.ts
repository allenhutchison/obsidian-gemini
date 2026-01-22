/**
 * Update Notification Modal - Shows release notes when plugin is updated
 */

import { App, Modal } from 'obsidian';

// Repository configuration
const REPOSITORY_URL = 'https://github.com/allenhutchison/obsidian-gemini';

interface ReleaseNote {
	title: string;
	highlights: string[];
	details?: string;
}

/**
 * Get release notes for a specific version
 */
function getReleaseNotes(version: string): ReleaseNote | null {
	const notes: Record<string, ReleaseNote> = {
		'4.2.1': {
			title: '🔧 Gemini Scribe 4.2.1 - RAG Stability & New Features',
			highlights: [
				'🐛 Fixed RAG re-indexing on every Obsidian restart',
				'📄 PDF and attachment indexing support',
				'⏸️ Pause/resume commands for RAG sync',
				'📊 Detailed status modal with file lists and search',
				'🔄 Resume interrupted indexing after crash/restart',
				'⚡ Rate limit handling with automatic retry',
				'💾 Incremental cache saves for durability',
			],
			details:
				'This update brings major stability improvements to RAG indexing. The vault no longer re-indexes on every restart, and you can now index PDFs and attachments. New pause/resume commands give you control over syncing, and interrupted indexing can be resumed. The status modal now shows detailed file lists with search functionality.',
		},
		'4.2.0': {
			title: '✨ Gemini Scribe 4.2 - Semantic Search & Improved Errors',
			highlights: [
				'🔬 [Experimental] Semantic vault search using Google File Search API',
				'🗂️ Background indexing keeps your vault searchable',
				'💬 Clearer API error messages (quota, auth, rate limits)',
				'🖼️ Fixed image model dropdown in settings',
				'✏️ Fixed writing tool to respect YAML frontmatter',
			],
			details:
				"This update introduces experimental semantic search powered by Google's File Search API. When enabled in Advanced Settings, your vault is indexed in the background, allowing the AI to search by meaning rather than just keywords. Also includes improved error messages that clearly explain API issues like quota limits or authentication problems.",
		},
		'4.1.2': {
			title: '🐛 Gemini Scribe 4.1.2 - Writing Tool Fix',
			highlights: [
				'✏️ Fixed writing tool to properly respect YAML frontmatter',
				'📝 Content is now correctly placed after frontmatter blocks',
				'🔍 Added edge case handling for malformed frontmatter',
				'📚 Improved documentation for YAML handling',
			],
			details:
				'This update fixes an important issue where the writing tool would incorrectly place content at the very beginning of files, overwriting or disrupting YAML frontmatter. The tool now properly detects and preserves frontmatter blocks (defined by --- delimiters), placing new content after them as intended.',
		},
		'4.1.1': {
			title: '🐛 Gemini Scribe 4.1.1 - Stability & UX Improvements',
			highlights: [
				'💬 In-chat confirmations - no more hidden modal dialogs',
				'🧠 Fixed Gemini 3 thinking mode display',
				'🔧 Fixed Gemini 3 function calling with thought signatures',
				'⏱️ Agent timeout protection prevents infinite hangs',
				'🎨 Better visual feedback during tool execution',
			],
			details:
				'This update focuses on stability and user experience. Confirmation dialogs are now inline in the chat, Gemini 3 models work properly with thinking mode and function calling, and the agent includes timeout protection to prevent getting stuck.',
		},
		'4.1.0': {
			title: '✨ Gemini Scribe 4.1 - Enhanced AI & Better UX',
			highlights: [
				'🌍 Multilingual support - prompts in your language',
				'🧠 Gemini 2.5 Pro & Gemini 3 with thinking progress',
				'🛑 Stop button to cancel long-running operations',
				'💡 Dynamic example prompts based on your vault',
				'🎨 Improved UI with icon buttons and progress indicators',
				'🔍 Enhanced search with new file content tool',
			],
			details:
				'This update brings powerful new AI models, multilingual support, and major UX improvements. Includes important security fixes and better vault operations.',
		},
		'4.0.0': {
			title: '🎉 Welcome to Gemini Scribe 4.0!',
			highlights: [
				'🤖 Unified agent-first interface - one powerful chat mode',
				'🔧 Tool calling built-in to every conversation',
				'💾 Persistent agent sessions with full history',
				'📦 Old history safely archived as readable markdown',
			],
			details:
				'This is a major update focused entirely on the powerful Agent Mode. The old note-based chat has been removed in favor of a unified agent experience with tool calling, persistent sessions, and better context management.',
		},
	};

	return notes[version] || null;
}

/**
 * Modal that shows update notifications with release notes
 */
export class UpdateNotificationModal extends Modal {
	private newVersion: string;
	private releaseNotes: ReleaseNote | null;

	constructor(app: App, newVersion: string) {
		super(app);
		this.newVersion = newVersion;
		this.releaseNotes = getReleaseNotes(newVersion);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Add modal styling
		contentEl.addClass('gemini-update-notification-modal');

		// If we have specific release notes for this version, show them
		if (this.releaseNotes) {
			this.showVersionSpecificNotes();
		} else {
			// Generic update notification
			this.showGenericUpdate();
		}
	}

	private showVersionSpecificNotes() {
		const { contentEl } = this;
		const releaseNotes = this.releaseNotes!;

		// Header
		contentEl.createEl('h2', {
			text: releaseNotes.title,
			cls: 'gemini-update-header',
		});

		// Version info
		contentEl.createEl('p', {
			text: `You've been updated to version ${this.newVersion}`,
			cls: 'gemini-update-version',
		});

		// Highlights
		if (releaseNotes.highlights.length > 0) {
			const highlightsDiv = contentEl.createDiv({ cls: 'gemini-update-highlights' });
			highlightsDiv.createEl('h3', { text: "What's New:" });
			const list = highlightsDiv.createEl('ul');
			releaseNotes.highlights.forEach((highlight) => {
				list.createEl('li', { text: highlight });
			});
		}

		// Details
		if (releaseNotes.details) {
			const detailsDiv = contentEl.createDiv({ cls: 'gemini-update-details' });
			detailsDiv.createEl('p', { text: releaseNotes.details });
		}

		// Action buttons
		this.addActionButtons();
	}

	private showGenericUpdate() {
		const { contentEl } = this;

		// Header
		contentEl.createEl('h2', {
			text: `🎉 Gemini Scribe Updated!`,
			cls: 'gemini-update-header',
		});

		// Version info
		contentEl.createEl('p', {
			text: `You've been updated to version ${this.newVersion}`,
			cls: 'gemini-update-version',
		});

		// Generic message
		const message = contentEl.createDiv({ cls: 'gemini-update-message' });
		message.createEl('p', {
			text: 'Thank you for using Gemini Scribe! This update includes improvements and bug fixes.',
		});

		// Action buttons
		this.addActionButtons();
	}

	private addActionButtons() {
		const { contentEl } = this;

		// Button container
		const buttonContainer = contentEl.createDiv({ cls: 'gemini-update-buttons' });

		// Close button
		const closeButton = buttonContainer.createEl('button', {
			text: 'Get Started',
			cls: 'mod-cta',
		});
		closeButton.addEventListener('click', () => {
			this.close();
		});

		// View release notes link (if available)
		const releaseNotesLink = contentEl.createDiv({ cls: 'gemini-update-links' });
		const link = releaseNotesLink.createEl('a', {
			text: '📖 View Full Release Notes',
			href: `${REPOSITORY_URL}/releases/tag/${this.newVersion}`,
		});
		link.addEventListener('click', (e) => {
			e.preventDefault();
			window.open(link.href, '_blank');
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

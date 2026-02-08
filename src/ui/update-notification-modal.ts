/**
 * Update Notification Modal - Shows release notes when plugin is updated
 */

import { App, Modal } from 'obsidian';
// @ts-ignore - JSON imported via esbuild loader
import releaseNotesData from '../release-notes.json';

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
	const notes = releaseNotesData as Record<string, ReleaseNote>;
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

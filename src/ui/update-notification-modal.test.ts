/**
 * Tests for UpdateNotificationModal
 */

import { UpdateNotificationModal } from './update-notification-modal';
import { App } from 'obsidian';

// Mock Obsidian
jest.mock('obsidian', () => {
	// Create a mock element with Obsidian-specific methods
	const createMockElement = (tag: string = 'div'): any => {
		const element = document.createElement(tag);

		// Add Obsidian-specific methods
		(element as any).empty = function() {
			this.innerHTML = '';
			return this;
		};

		(element as any).addClass = function(cls: string) {
			this.classList.add(cls);
			return this;
		};

		(element as any).createEl = function(tag: string, options?: any) {
			const el = createMockElement(tag);
			if (options?.text) el.textContent = options.text;
			if (options?.cls) el.classList.add(options.cls);
			if (options?.href) el.setAttribute('href', options.href);
			this.appendChild(el);
			return el;
		};

		(element as any).createDiv = function(options?: any) {
			return this.createEl('div', options);
		};

		return element;
	};

	return {
		Modal: class Modal {
			app: any;
			contentEl: any;

			constructor(app: any) {
				this.app = app;
				this.contentEl = createMockElement('div');
			}

			open() {}
			close() {}
		}
	};
});

describe('UpdateNotificationModal', () => {
	let app: App;
	let modal: UpdateNotificationModal;

	beforeEach(() => {
		// Reset DOM
		document.body.innerHTML = '';

		// Mock app
		app = {} as App;
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('Version-Specific Release Notes (v4.0.0)', () => {
		beforeEach(() => {
			modal = new UpdateNotificationModal(app, '4.0.0');
		});

		it('should create modal with correct version', () => {
			expect(modal).toBeDefined();
			expect((modal as any).newVersion).toBe('4.0.0');
		});

		it('should have release notes for v4.0.0', () => {
			expect((modal as any).releaseNotes).toBeDefined();
			expect((modal as any).releaseNotes).not.toBeNull();
		});

		it('should display version-specific title', () => {
			modal.onOpen();

			const header = modal.contentEl.querySelector('h2');
			expect(header).toBeDefined();
			expect(header?.textContent).toContain('Welcome to Gemini Scribe 4.0');
		});

		it('should display correct version number', () => {
			modal.onOpen();

			const versionText = modal.contentEl.querySelector('.gemini-update-version');
			expect(versionText).toBeDefined();
			expect(versionText?.textContent).toContain('4.0.0');
		});

		it('should display highlights section', () => {
			modal.onOpen();

			const highlights = modal.contentEl.querySelector('.gemini-update-highlights');
			expect(highlights).toBeDefined();

			const list = highlights?.querySelector('ul');
			expect(list).toBeDefined();

			const items = list?.querySelectorAll('li');
			expect(items).toBeDefined();
			expect(items!.length).toBeGreaterThan(0);
		});

		it('should display details section', () => {
			modal.onOpen();

			const details = modal.contentEl.querySelector('.gemini-update-details');
			expect(details).toBeDefined();
			expect(details?.textContent).toContain('Agent Mode');
		});

		it('should have GitHub release link with correct URL', () => {
			modal.onOpen();

			const link = modal.contentEl.querySelector('a[href*="github.com"]');
			expect(link).toBeDefined();
			expect(link?.getAttribute('href')).toContain('/releases/tag/4.0.0');
			expect(link?.getAttribute('href')).toContain('allenhutchison/obsidian-gemini');
		});

		it('should have Get Started button', () => {
			modal.onOpen();

			const button = modal.contentEl.querySelector('button.mod-cta');
			expect(button).toBeDefined();
			expect(button?.textContent).toContain('Get Started');
		});
	});

	describe('Generic Update Message', () => {
		beforeEach(() => {
			modal = new UpdateNotificationModal(app, '3.5.0');
		});

		it('should not have version-specific release notes for unknown versions', () => {
			expect((modal as any).releaseNotes).toBeNull();
		});

		it('should display generic update title', () => {
			modal.onOpen();

			const header = modal.contentEl.querySelector('h2');
			expect(header).toBeDefined();
			expect(header?.textContent).toContain('Gemini Scribe Updated');
		});

		it('should display correct version number', () => {
			modal.onOpen();

			const versionText = modal.contentEl.querySelector('.gemini-update-version');
			expect(versionText).toBeDefined();
			expect(versionText?.textContent).toContain('3.5.0');
		});

		it('should display generic message', () => {
			modal.onOpen();

			const message = modal.contentEl.querySelector('.gemini-update-message');
			expect(message).toBeDefined();
			expect(message?.textContent).toContain('improvements and bug fixes');
		});

		it('should have GitHub release link', () => {
			modal.onOpen();

			const link = modal.contentEl.querySelector('a[href*="github.com"]');
			expect(link).toBeDefined();
			expect(link?.getAttribute('href')).toContain('/releases/tag/3.5.0');
		});
	});

	describe('Modal Lifecycle', () => {
		beforeEach(() => {
			modal = new UpdateNotificationModal(app, '4.0.0');
		});

		it('should add modal styling class on open', () => {
			modal.onOpen();

			expect(modal.contentEl.classList.contains('gemini-update-notification-modal')).toBe(true);
		});

		it('should empty content on close', () => {
			modal.onOpen();
			expect(modal.contentEl.children.length).toBeGreaterThan(0);

			modal.onClose();
			expect(modal.contentEl.children.length).toBe(0);
		});

		it('should handle re-opening after close', () => {
			modal.onOpen();
			modal.onClose();
			modal.onOpen();

			expect(modal.contentEl.children.length).toBeGreaterThan(0);
		});
	});

	describe('Link Interaction', () => {
		beforeEach(() => {
			modal = new UpdateNotificationModal(app, '4.0.0');
			// Mock window.open
			global.window.open = jest.fn();
		});

		it('should prevent default link behavior and open in new window', () => {
			modal.onOpen();

			const link = modal.contentEl.querySelector('a') as HTMLAnchorElement;
			expect(link).toBeDefined();

			const event = new MouseEvent('click', { bubbles: true, cancelable: true });
			const preventDefaultSpy = jest.spyOn(event, 'preventDefault');

			link.dispatchEvent(event);

			expect(preventDefaultSpy).toHaveBeenCalled();
		});
	});

	describe('Edge Cases', () => {
		it('should handle empty version string', () => {
			modal = new UpdateNotificationModal(app, '');
			modal.onOpen();

			expect(modal.contentEl.children.length).toBeGreaterThan(0);
		});

		it('should handle malformed version strings', () => {
			modal = new UpdateNotificationModal(app, 'not-a-version');
			modal.onOpen();

			// Should fall back to generic message
			const header = modal.contentEl.querySelector('h2');
			expect(header?.textContent).toContain('Gemini Scribe Updated');
		});

		it('should handle version with v prefix', () => {
			modal = new UpdateNotificationModal(app, 'v4.0.0');
			modal.onOpen();

			const versionText = modal.contentEl.querySelector('.gemini-update-version');
			expect(versionText?.textContent).toContain('v4.0.0');
		});
	});

	describe('Repository URL Configuration', () => {
		it('should use configured repository URL', () => {
			modal = new UpdateNotificationModal(app, '4.0.0');
			modal.onOpen();

			const link = modal.contentEl.querySelector('a') as HTMLAnchorElement;
			expect(link.href).toContain('github.com/allenhutchison/obsidian-gemini');
		});

		it('should construct correct release tag URL', () => {
			modal = new UpdateNotificationModal(app, '5.1.2');
			modal.onOpen();

			const link = modal.contentEl.querySelector('a') as HTMLAnchorElement;
			expect(link.href).toMatch(/releases\/tag\/5\.1\.2$/);
		});
	});
});

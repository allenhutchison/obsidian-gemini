import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setIcon } from 'obsidian';
import type { TFile } from 'obsidian';
import {
	setCollapsibleExpanded,
	wireCollapsibleToggle,
	type CollapsibleRefs,
} from '../../../src/ui/agent-view/collapsible';
import { buildCompactionEntry } from '../../../src/ui/agent-view/compaction-notice';
import { TOOL_ICONS } from '../../../src/ui/agent-view/tool-icons';
import { AgentViewContext } from '../../../src/ui/agent-view/agent-view-context';
import type { ChatSession } from '../../../src/types/agent';

// The four agent-view leaf modules covered here were each extracted as shared
// helpers (#1227, #1213, #1214) precisely so two call sites could not drift
// apart again. They are pure — no Obsidian lifecycle — so they share one fixture
// file rather than one file each.

const setIconMock = setIcon as unknown as ReturnType<typeof vi.fn>;

function makeRefs(expandedClass = 'gemini-tool-group-expanded'): CollapsibleRefs {
	const host = document.createElement('div');
	const control = document.createElement('div');
	const body = document.createElement('div');
	const chevron = document.createElement('span');
	host.append(control, body);
	control.append(chevron);
	return { control, body, chevron, host, expandedClass };
}

beforeEach(() => {
	setIconMock.mockClear();
});

describe('collapsible', () => {
	describe('setCollapsibleExpanded', () => {
		it('applies the expanded state across all four refs', () => {
			const refs = makeRefs();

			setCollapsibleExpanded(refs, true);

			expect(refs.body.style.display).toBe('block');
			expect(refs.host.classList.contains('gemini-tool-group-expanded')).toBe(true);
			expect(refs.control.getAttribute('aria-expanded')).toBe('true');
			expect(setIconMock).toHaveBeenCalledWith(refs.chevron, 'chevron-down');
		});

		it('applies the collapsed state across all four refs', () => {
			const refs = makeRefs();
			setCollapsibleExpanded(refs, true);
			setIconMock.mockClear();

			setCollapsibleExpanded(refs, false);

			expect(refs.body.style.display).toBe('none');
			expect(refs.host.classList.contains('gemini-tool-group-expanded')).toBe(false);
			expect(refs.control.getAttribute('aria-expanded')).toBe('false');
			expect(setIconMock).toHaveBeenCalledWith(refs.chevron, 'chevron-right');
		});

		it('honours the caller-supplied expanded class', () => {
			const refs = makeRefs('gemini-tool-row-expanded');

			setCollapsibleExpanded(refs, true);

			expect(refs.host.classList.contains('gemini-tool-row-expanded')).toBe(true);
			expect(refs.host.classList.contains('gemini-tool-group-expanded')).toBe(false);
		});
	});

	describe('wireCollapsibleToggle', () => {
		it('expands on first click when aria-expanded was never set', () => {
			// A freshly-built header has no aria-expanded attribute; the missing
			// attribute must read as collapsed, so the first click opens it.
			const refs = makeRefs();
			wireCollapsibleToggle(refs);

			refs.control.dispatchEvent(new MouseEvent('click'));

			expect(refs.control.getAttribute('aria-expanded')).toBe('true');
			expect(refs.body.style.display).toBe('block');
		});

		it('toggles back and forth on repeated clicks', () => {
			const refs = makeRefs();
			wireCollapsibleToggle(refs);

			refs.control.dispatchEvent(new MouseEvent('click'));
			refs.control.dispatchEvent(new MouseEvent('click'));

			expect(refs.control.getAttribute('aria-expanded')).toBe('false');
			expect(refs.body.style.display).toBe('none');
		});

		// State is read back off aria-expanded rather than kept in a closure, so
		// programmatic expansion (auto-expand on tool error) and user clicks stay in
		// sync — the next click must collapse, not re-expand.
		it('picks up programmatic expansion instead of tracking its own state', () => {
			const refs = makeRefs();
			wireCollapsibleToggle(refs);

			setCollapsibleExpanded(refs, true);
			refs.control.dispatchEvent(new MouseEvent('click'));

			expect(refs.control.getAttribute('aria-expanded')).toBe('false');
		});

		it.each([
			['Enter', 'Enter'],
			['Space', ' '],
		])('toggles on %s and suppresses the default action', (_label, key) => {
			const refs = makeRefs();
			wireCollapsibleToggle(refs);
			const event = new KeyboardEvent('keydown', { key, cancelable: true });

			refs.control.dispatchEvent(event);

			expect(refs.control.getAttribute('aria-expanded')).toBe('true');
			// Space would otherwise scroll the tool activity block.
			expect(event.defaultPrevented).toBe(true);
		});

		it('ignores unrelated keys', () => {
			const refs = makeRefs();
			wireCollapsibleToggle(refs);
			const event = new KeyboardEvent('keydown', { key: 'a', cancelable: true });

			refs.control.dispatchEvent(event);

			expect(refs.control.getAttribute('aria-expanded')).toBeNull();
			expect(event.defaultPrevented).toBe(false);
		});
	});
});

describe('buildCompactionEntry', () => {
	it('builds a model entry carrying the summary below the notice callout', () => {
		const entry = buildCompactionEntry('Earlier turns discussed the vault layout.', 'gemini-3-flash-preview');

		expect(entry.role).toBe('model');
		expect(entry.model).toBe('gemini-3-flash-preview');
		expect(entry.notePath).toBe('');
		expect(entry.created_at).toBeInstanceOf(Date);
		expect(entry.message).toContain('Earlier turns discussed the vault layout.');
	});

	// The message is persisted into session markdown, so the callout marker is a
	// file-format detail: it must stay an `[!info]` callout and stay English
	// (never routed through `t()`) per the repo's i18n invariant.
	it('serializes as an English [!info] callout', () => {
		const entry = buildCompactionEntry('summary', 'gemini-3-flash-preview');

		expect(entry.message.startsWith('> [!info] Context Compacted\n')).toBe(true);
		expect(entry.message).toContain('> Older conversation turns have been summarized to maintain performance.');
	});

	// Both compaction paths (pre-turn in agent-view-send, mid-loop via
	// onMidLoopCompaction — #662) call this helper so the two notices cannot drift.
	it('produces an identical notice for identical inputs', () => {
		const preTurn = buildCompactionEntry('same summary', 'gemini-3-pro-preview');
		const midLoop = buildCompactionEntry('same summary', 'gemini-3-pro-preview');

		expect(midLoop.message).toBe(preTurn.message);
	});

	it('keeps the callout intact for an empty summary', () => {
		const entry = buildCompactionEntry('', 'gemini-3-flash-preview');

		expect(entry.message.startsWith('> [!info] Context Compacted\n')).toBe(true);
	});
});

describe('TOOL_ICONS', () => {
	// These are the entries that had drifted between the two partial copies the
	// map replaced, so they are the ones worth pinning by name.
	it.each([
		['read_file', 'file-text'],
		['write_file', 'file-edit'],
		['list_files', 'folder-open'],
		['create_folder', 'folder-plus'],
		['delete_file', 'trash-2'],
		['move_file', 'file-symlink'],
		['find_files_by_name', 'search'],
		['find_files_by_content', 'search'],
		['google_search', 'globe'],
		['google_maps', 'map-pin'],
		['fetch_url', 'link'],
		['generate_image', 'image'],
	])('maps %s to the %s icon', (toolName, icon) => {
		expect(TOOL_ICONS[toolName]).toBe(icon);
	});

	it('leaves unmapped tool names undefined so callers apply their own fallback', () => {
		expect(TOOL_ICONS['activate_skill']).toBeUndefined();
		expect(TOOL_ICONS['some_mcp_tool']).toBeUndefined();
	});

	it('has a non-empty icon id for every entry', () => {
		for (const [toolName, icon] of Object.entries(TOOL_ICONS)) {
			expect(icon, `${toolName} has an empty icon id`).toBeTruthy();
		}
	});
});

describe('AgentViewContext', () => {
	// The class only ever uses reference identity (includes/indexOf/push/splice),
	// so plain stand-ins are enough and avoid depending on the TFile constructor.
	const fileA = { path: 'notes/a.md' } as TFile;
	const fileB = { path: 'notes/b.md' } as TFile;
	const fileC = { path: 'notes/c.md' } as TFile;

	let context: AgentViewContext;
	let session: ChatSession;

	function makeSession(contextFiles: TFile[] = []): ChatSession {
		return { context: { contextFiles } } as unknown as ChatSession;
	}

	beforeEach(() => {
		context = new AgentViewContext();
		session = makeSession();
	});

	describe('addFileToContext', () => {
		it('adds a file that is not present', () => {
			context.addFileToContext(fileA, session);

			expect(session.context.contextFiles).toEqual([fileA]);
		});

		it('does not add the same file twice', () => {
			context.addFileToContext(fileA, session);
			context.addFileToContext(fileA, session);

			expect(session.context.contextFiles).toEqual([fileA]);
		});

		it('preserves insertion order across distinct files', () => {
			context.addFileToContext(fileA, session);
			context.addFileToContext(fileB, session);

			expect(session.context.contextFiles).toEqual([fileA, fileB]);
		});
	});

	describe('addFilesToContext', () => {
		it('adds every file in the batch', () => {
			context.addFilesToContext([fileA, fileB, fileC], session);

			expect(session.context.contextFiles).toEqual([fileA, fileB, fileC]);
		});

		it('skips files already in the context', () => {
			session = makeSession([fileB]);

			context.addFilesToContext([fileA, fileB], session);

			expect(session.context.contextFiles).toEqual([fileB, fileA]);
		});

		it('de-duplicates within a single batch', () => {
			context.addFilesToContext([fileA, fileA], session);

			expect(session.context.contextFiles).toEqual([fileA]);
		});

		it('accepts an empty batch', () => {
			context.addFilesToContext([], session);

			expect(session.context.contextFiles).toEqual([]);
		});
	});

	describe('removeContextFile', () => {
		it('removes the file and leaves the rest in order', () => {
			session = makeSession([fileA, fileB, fileC]);

			context.removeContextFile(fileB, session);

			expect(session.context.contextFiles).toEqual([fileA, fileC]);
		});

		it('is a no-op for a file that is not in the context', () => {
			session = makeSession([fileA]);

			context.removeContextFile(fileB, session);

			expect(session.context.contextFiles).toEqual([fileA]);
		});

		it('removes only one occurrence', () => {
			// addFileToContext dedupes, but history restore can hand back a list that
			// does not — removal must not clear both entries at once.
			session = makeSession([fileA, fileA]);

			context.removeContextFile(fileA, session);

			expect(session.context.contextFiles).toEqual([fileA]);
		});
	});

	// The agent view calls these before a session exists (drag-and-drop onto an
	// empty view), so a null session must be tolerated rather than thrown on.
	describe('with no active session', () => {
		it.each([
			['addFileToContext', (c: AgentViewContext) => c.addFileToContext(fileA, null)],
			['addFilesToContext', (c: AgentViewContext) => c.addFilesToContext([fileA], null)],
			['removeContextFile', (c: AgentViewContext) => c.removeContextFile(fileA, null)],
		])('%s does not throw', (_label, call) => {
			expect(() => call(context)).not.toThrow();
		});
	});
});

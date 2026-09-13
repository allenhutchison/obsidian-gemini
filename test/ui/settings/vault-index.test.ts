/**
 * Tests for the Vault search index settings page (settings-redesign WP3,
 * design doc §5.4): the page-definition shape and the DOM-free `RAG_WRITERS`
 * — in particular the `ragIndexing.excludeFolders` textarea round-trip
 * (review M2: it must never corrupt the `string[]` field) and the
 * `ragIndexing.enabled` disable-with-confirmation flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SettingDefinitionControl, SettingDefinitionGroup, SettingDefinitionRender } from 'obsidian';

const cleanupResult = vi.hoisted(() => ({ deleteData: false, threw: false }));

vi.mock('../../../src/ui/rag-cleanup-modal', () => ({
	RagCleanupModal: vi.fn().mockImplementation(function (
		this: any,
		_app: unknown,
		onConfirm: (deleteData: boolean) => void
	) {
		this.open = () => {
			if (cleanupResult.threw) throw new Error('modal load failed');
			onConfirm(cleanupResult.deleteData);
		};
	}),
}));

import { vaultIndexPage, RAG_WRITERS } from '../../../src/ui/settings/page-vault-index';
import type { SettingsContext } from '../../../src/ui/settings/context';

function makePlugin(overrides: Partial<{ enabled: boolean; storeName: string | null; indexedCount: number }> = {}) {
	const ragIndexing = {
		getIndexedFileCount: vi.fn(() => overrides.indexedCount ?? 0),
		indexVault: vi.fn(async () => ({ indexed: 1, skipped: 0, failed: 0, duration: 10 })),
		deleteFileSearchStore: vi.fn(async () => {}),
	};
	return {
		app: { vault: { configDir: '.obsidian' } },
		settings: {
			historyFolder: 'gemini-scribe',
			ragIndexing: {
				enabled: overrides.enabled ?? false,
				fileSearchStoreName: overrides.storeName ?? null,
				excludeFolders: [],
				autoSync: true,
				includeAttachments: false,
			},
		},
		ragIndexing,
		logger: { error: vi.fn(), warn: vi.fn(), log: vi.fn(), debug: vi.fn() },
	} as any;
}

function makeCtx(plugin: any): SettingsContext {
	return { plugin, app: plugin.app, tab: { update: vi.fn(), refreshDomState: vi.fn() } };
}

beforeEach(() => {
	cleanupResult.deleteData = false;
	cleanupResult.threw = false;
});

describe('vaultIndexPage', () => {
	it('reports "Off" as the displayValue when indexing is disabled', () => {
		const plugin = makePlugin({ enabled: false });
		const page = vaultIndexPage(makeCtx(plugin));
		expect((page.displayValue as () => string)()).toBe('Off');
	});

	it('reports the indexed file count as the displayValue when enabled', () => {
		const plugin = makePlugin({ enabled: true, indexedCount: 42 });
		const page = vaultIndexPage(makeCtx(plugin));
		expect((page.displayValue as () => string)()).toBe('On · 42 files');
	});

	it('has the enable toggle bound to ragIndexing.enabled', () => {
		const plugin = makePlugin();
		const page = vaultIndexPage(makeCtx(plugin));
		const enableRow = page.items?.find(
			(item): item is SettingDefinitionControl =>
				'control' in item && (item as SettingDefinitionControl).control?.key === 'ragIndexing.enabled'
		);
		expect(enableRow).toBeDefined();
		expect(enableRow?.control).toMatchObject({ type: 'toggle', key: 'ragIndexing.enabled' });
	});

	it('gates the "What gets indexed" group and exclude-folders textarea behind ragIndexing.enabled', () => {
		const plugin = makePlugin({ enabled: true });
		const page = vaultIndexPage(makeCtx(plugin));
		const group = page.items?.find(
			(item) => (item as SettingDefinitionGroup).type === 'group'
		) as SettingDefinitionGroup;
		expect(group).toBeDefined();
		expect(typeof group.visible).toBe('function');
		expect((group.visible as () => boolean)()).toBe(true);

		const excludeRow = group.items?.find(
			(item) => 'control' in item && (item as SettingDefinitionControl).control?.key === 'ragIndexing.excludeFolders'
		) as SettingDefinitionControl;
		expect(excludeRow.control).toMatchObject({ type: 'textarea', key: 'ragIndexing.excludeFolders' });
	});

	it('has a Status render row visible only while indexing is enabled', () => {
		const enabledPlugin = makePlugin({ enabled: true });
		const enabledPage = vaultIndexPage(makeCtx(enabledPlugin));
		const statusRow = enabledPage.items?.find(
			(item) => 'render' in item && typeof (item as SettingDefinitionRender).render === 'function'
		);
		expect(statusRow).toBeDefined();
		expect(((statusRow as SettingDefinitionRender).visible as () => boolean)()).toBe(true);

		const disabledPlugin = makePlugin({ enabled: false });
		const disabledPage = vaultIndexPage(makeCtx(disabledPlugin));
		const disabledStatusRow = disabledPage.items?.find(
			(item) => 'render' in item && typeof (item as SettingDefinitionRender).render === 'function'
		) as SettingDefinitionRender;
		expect((disabledStatusRow.visible as () => boolean)()).toBe(false);
	});
});

describe('RAG_WRITERS["ragIndexing.excludeFolders"]', () => {
	it('rejects a non-string value without mutating settings', async () => {
		const plugin = makePlugin();
		const before = plugin.settings.ragIndexing.excludeFolders;
		const result = await RAG_WRITERS['ragIndexing.excludeFolders'](plugin, 'ragIndexing.excludeFolders', 123);
		expect(result).toEqual({ needsUpdate: false });
		expect(plugin.settings.ragIndexing.excludeFolders).toBe(before);
	});

	it('splits on newlines, trims, drops blank lines, and drops system folders', async () => {
		const plugin = makePlugin();
		const input = 'notes/private\n\n   \nfolder2\ngemini-scribe\n.obsidian\n  folder3  ';
		const result = await RAG_WRITERS['ragIndexing.excludeFolders'](plugin, 'ragIndexing.excludeFolders', input);
		expect(result).toEqual({ needsUpdate: false });
		expect(plugin.settings.ragIndexing.excludeFolders).toEqual(['notes/private', 'folder2', 'folder3']);
	});

	it('produces a real array, never a joined string (the M2 corruption case)', async () => {
		const plugin = makePlugin();
		await RAG_WRITERS['ragIndexing.excludeFolders'](plugin, 'ragIndexing.excludeFolders', 'a\nb\nc');
		expect(Array.isArray(plugin.settings.ragIndexing.excludeFolders)).toBe(true);
		expect(plugin.settings.ragIndexing.excludeFolders).toHaveLength(3);
	});
});

describe('RAG_WRITERS["ragIndexing.enabled"]', () => {
	it('enabling never opens the cleanup modal', async () => {
		const plugin = makePlugin({ enabled: false });
		const result = await RAG_WRITERS['ragIndexing.enabled'](plugin, 'ragIndexing.enabled', true);
		expect(result).toEqual({ needsUpdate: true });
		expect(plugin.settings.ragIndexing.enabled).toBe(true);
	});

	it('disabling with no existing store skips the modal', async () => {
		const plugin = makePlugin({ enabled: true, storeName: null });
		const result = await RAG_WRITERS['ragIndexing.enabled'](plugin, 'ragIndexing.enabled', false);
		expect(result).toEqual({ needsUpdate: true });
		expect(plugin.settings.ragIndexing.enabled).toBe(false);
	});

	it('disabling with an existing store and "keep" leaves the remote store alone', async () => {
		cleanupResult.deleteData = false;
		const plugin = makePlugin({ enabled: true, storeName: 'stores/abc123' });
		const result = await RAG_WRITERS['ragIndexing.enabled'](plugin, 'ragIndexing.enabled', false);
		expect(result).toEqual({ needsUpdate: true });
		expect(plugin.settings.ragIndexing.enabled).toBe(false);
		expect(plugin.ragIndexing.deleteFileSearchStore).not.toHaveBeenCalled();
	});

	it('disabling with an existing store and "delete" removes the remote store', async () => {
		cleanupResult.deleteData = true;
		const plugin = makePlugin({ enabled: true, storeName: 'stores/abc123' });
		const result = await RAG_WRITERS['ragIndexing.enabled'](plugin, 'ragIndexing.enabled', false);
		expect(result).toEqual({ needsUpdate: true });
		expect(plugin.settings.ragIndexing.enabled).toBe(false);
		expect(plugin.ragIndexing.deleteFileSearchStore).toHaveBeenCalledOnce();
	});

	it('reverts to enabled on a failed delete rather than silently disabling', async () => {
		cleanupResult.deleteData = true;
		const plugin = makePlugin({ enabled: true, storeName: 'stores/abc123' });
		plugin.ragIndexing.deleteFileSearchStore.mockRejectedValueOnce(new Error('network error'));
		const result = await RAG_WRITERS['ragIndexing.enabled'](plugin, 'ragIndexing.enabled', false);
		expect(result).toEqual({ needsUpdate: true });
		expect(plugin.settings.ragIndexing.enabled).toBe(true);
		expect(plugin.logger.error).toHaveBeenCalled();
	});
});

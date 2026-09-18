/**
 * Tree-shape test for the whole settings-UI package (settings-redesign
 * design doc §8.2): walks `getSettingDefinitions()` as data rather than
 * rendering DOM, so it's cheap and catches drift across the whole surface in
 * one place.
 */
import type { App } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import ObsidianGeminiSettingTab from '../../../src/ui/settings';
import { controlValueTypeMatches } from '../../../src/ui/settings/paths';
import { en } from '../../../src/i18n/en';
import { buildPlugin, buildApp } from './fixtures';

function walk(
	items: SettingDefinitionItem[],
	visit: (item: SettingDefinitionItem, path: string) => void,
	path = ''
): void {
	items.forEach((item, index) => {
		const label = 'name' in item && typeof item.name === 'string' ? item.name : `#${index}`;
		const itemPath = `${path}/${label}`;
		visit(item, itemPath);
		const nested = (item as { items?: SettingDefinitionItem[] }).items;
		if (Array.isArray(nested)) {
			walk(nested, visit, itemPath);
		}
	});
}

function buildTab() {
	const plugin = buildPlugin();
	const app = buildApp() as unknown as App;
	const tab = new ObsidianGeminiSettingTab(app, plugin);
	return { tab, plugin, app };
}

const EN_MESSAGES: Set<string> = new Set(Object.values(en).map((entry) => entry.message as string));

describe('ObsidianGeminiSettingTab#getSettingDefinitions', () => {
	it('returns exactly 13 top-level rows in the designed order', () => {
		const { tab } = buildTab();
		const items = tab.getSettingDefinitions();

		// Flatten groups one level to count "rows" the way the mockup does:
		// Providers, Features, [Chat group: 3], [Vault group: 2], [Automation
		// group: 3], Tool permissions, Advanced, Documentation = 2 + 3 + 2 + 3 + 3 = 13.
		let rowCount = 0;
		for (const raw of items) {
			const item = raw as { type?: string; items?: unknown[] };
			if (item.type === 'group') {
				rowCount += (item.items ?? []).length;
			} else {
				rowCount += 1;
			}
		}
		expect(rowCount).toBe(13);

		expect(items[0]).toMatchObject({ type: 'page', name: 'Providers' });
		expect(items[1]).toMatchObject({ type: 'page', name: 'Features' });
		expect(items[items.length - 1]).toMatchObject({ name: 'Documentation' });
	});

	it('every control key resolves through getControlValue, and every control value type matches its control type', () => {
		const { tab } = buildTab();
		const items = tab.getSettingDefinitions();
		const seenKeys = new Set<string>();

		walk(items, (item, path) => {
			const control = (item as { control?: { type: string; key: string } }).control;
			if (!control) return;
			expect(seenKeys.has(control.key)).toBe(false); // every control key is globally unique
			seenKeys.add(control.key);

			const value = tab.getControlValue(control.key);
			expect(
				controlValueTypeMatches(control.type, value),
				`control at ${path} (key '${control.key}', type '${control.type}') got a ${typeof value} value`
			).toBe(true);
		});

		// Sanity: today's tree does have controls to check (guards against the
		// walker silently matching nothing after a refactor).
		expect(seenKeys.size).toBeGreaterThan(0);
	});

	it('never hardcodes a user-facing row name or group heading — every one is a known en.ts message', () => {
		const { tab } = buildTab();
		const items = tab.getSettingDefinitions();

		walk(items, (item, path) => {
			const name = (item as { name?: unknown }).name;
			if (typeof name === 'string' && name.length > 0) {
				expect(EN_MESSAGES.has(name), `name at ${path} ('${name}') is not a known en.ts message`).toBe(true);
			}
			const heading = (item as { heading?: unknown }).heading;
			if (typeof heading === 'string' && heading.length > 0) {
				expect(EN_MESSAGES.has(heading), `heading at ${path} ('${heading}') is not a known en.ts message`).toBe(true);
			}
		});
	});

	it('Providers and Features top-level rows carry a reactive displayValue', () => {
		const { tab } = buildTab();
		const items = tab.getSettingDefinitions();
		const providers = items[0] as { displayValue?: () => string };
		const features = items[1] as { displayValue?: () => string };
		expect(typeof providers.displayValue).toBe('function');
		expect(typeof features.displayValue).toBe('function');
		expect(providers.displayValue!().length).toBeGreaterThan(0);
		expect(features.displayValue!().length).toBeGreaterThan(0);
	});

	it('the OpenAI card exposes only supported connection controls', () => {
		const { tab } = buildTab();
		const providers = tab.getSettingDefinitions()[0] as { items: SettingDefinitionItem[] };
		const openai = providers.items.find((item) => (item as { name?: string }).name === 'OpenAI') as {
			items: SettingDefinitionItem[];
		};

		expect(openai.items.slice(0, 2).map((item) => (item as { name?: string }).name)).toEqual(['API key', 'Base URL']);
		expect(openai.items.some((item) => 'disabled' in item)).toBe(false);
	});

	it('a feature routed to "none" displays Off with no warning status', () => {
		const plugin = buildPlugin({
			features: {
				chat: { provider: 'none', model: '' },
				summary: { provider: 'gemini', model: '' },
				completions: { provider: 'gemini', model: '' },
				rewrite: { provider: 'gemini', model: '' },
				webSearch: { provider: 'gemini', model: '' },
				deepResearch: { provider: 'gemini', model: '' },
				rag: { provider: 'gemini', model: '' },
				imageGen: { provider: 'gemini', model: '' },
			},
		});
		const app = buildApp() as unknown as App;
		const tab = new ObsidianGeminiSettingTab(app, plugin);
		const featuresPage = tab.getSettingDefinitions()[1] as { items: SettingDefinitionItem[] };
		const textGroup = featuresPage.items.find((i) => (i as { type?: string }).type === 'group') as {
			items: SettingDefinitionItem[];
		};
		const chatRow = textGroup.items.find((i) => (i as { name?: string }).name === 'Chat and agent') as {
			displayValue: () => string;
			status: () => 'warning' | null;
		};
		expect(chatRow.displayValue()).toBe('Off');
		expect(chatRow.status()).toBeNull();
	});

	it('a feature routed to an unconnected provider warns and shows "not connected"', () => {
		// apiKeySecretName '' (from buildSettings' default) means Gemini is unconfigured.
		const { tab } = buildTab();
		const featuresPage = tab.getSettingDefinitions()[1] as { items: SettingDefinitionItem[] };
		const textGroup = featuresPage.items.find((i) => (i as { type?: string }).type === 'group') as {
			items: SettingDefinitionItem[];
		};
		const chatRow = textGroup.items.find((i) => (i as { name?: string }).name === 'Chat and agent') as {
			displayValue: () => string;
			status: () => 'warning' | null;
		};
		expect(chatRow.displayValue()).toContain('not connected');
		expect(chatRow.status()).toBe('warning');
	});
});

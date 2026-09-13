/**
 * Tests for the Tool permissions settings page (settings-redesign WP3,
 * design doc §7): the page-definition shape, the pure `matchesFilter`
 * predicate, and the DOM-free `TOOL_POLICY_WRITERS` preset/custom transition
 * logic lifted out of the deleted `settings-tools.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SettingDefinitionGroup, SettingDefinitionControl, SettingDefinitionRender } from 'obsidian';
import { ToolClassification, ToolPermission, PolicyPreset } from '../../../src/types/tool-policy';
import type { Tool } from '../../../src/tools/types';

const yoloConfirmResult = vi.hoisted(() => ({ value: true, threw: false }));

vi.mock('../../../src/ui/yolo-confirmation-modal', () => ({
	YoloConfirmationModal: vi.fn().mockImplementation(function (
		this: any,
		_app: unknown,
		onConfirm: (confirmed: boolean) => void
	) {
		this.open = () => {
			if (yoloConfirmResult.threw) throw new Error('modal load failed');
			onConfirm(yoloConfirmResult.value);
		};
	}),
}));

import {
	toolPermissionsPage,
	matchesFilter,
	TOOL_POLICY_WRITERS,
	_resetActiveFilterForTests,
} from '../../../src/ui/settings/page-tool-permissions';
import type { SettingsContext } from '../../../src/ui/settings/context';

function makeTool(overrides: Partial<Tool> = {}): Tool {
	return {
		name: 'read_file',
		category: 'vault',
		classification: ToolClassification.READ,
		description: 'Read a note or attachment',
		parameters: { type: 'object', properties: {} },
		execute: vi.fn(),
		...overrides,
	};
}

function makeRegistry(tools: Tool[]) {
	const byName = new Map(tools.map((t) => [t.name, t]));
	return {
		getAllTools: () => tools,
		getTool: (name: string) => byName.get(name),
		// Approximates the Cautious preset's classification -> permission map,
		// which is the "current effective permission" every fixture here starts
		// from (no per-tool overrides, activePreset: CAUTIOUS).
		getEffectivePermission: vi.fn((name: string) => {
			const tool = byName.get(name);
			if (!tool) return ToolPermission.DENY;
			return tool.classification === ToolClassification.READ ? ToolPermission.APPROVE : ToolPermission.ASK_USER;
		}),
	};
}

function makePlugin(tools: Tool[] = [makeTool()]) {
	return {
		app: {},
		settings: {
			toolPolicy: { activePreset: PolicyPreset.CAUTIOUS, toolPermissions: {} },
		},
		toolRegistry: makeRegistry(tools),
		logger: { error: vi.fn(), warn: vi.fn(), log: vi.fn(), debug: vi.fn() },
	} as any;
}

function makeCtx(plugin: any): SettingsContext {
	return { plugin, app: plugin.app, tab: { update: vi.fn(), refreshDomState: vi.fn() } };
}

beforeEach(() => {
	_resetActiveFilterForTests();
	yoloConfirmResult.value = true;
	yoloConfirmResult.threw = false;
});

describe('toolPermissionsPage', () => {
	it('shows a no-tools row when the registry is empty', () => {
		const plugin = makePlugin([]);
		const page = toolPermissionsPage(makeCtx(plugin));
		expect(page.type).toBe('page');
		expect(page.items).toHaveLength(1);
		expect(page.items?.[0]).toMatchObject({ name: 'No tools registered' });
	});

	it('builds a preset row and a searchable tool group', () => {
		const tools = [
			makeTool({
				name: 'write_file',
				classification: ToolClassification.WRITE,
				description: 'Create or overwrite a note',
			}),
			makeTool({ name: 'read_file' }),
		];
		const plugin = makePlugin(tools);
		const page = toolPermissionsPage(makeCtx(plugin));

		expect(page.items).toHaveLength(2);

		const presetRow = page.items?.[0] as SettingDefinitionControl;
		expect(presetRow.control).toMatchObject({ type: 'dropdown', key: 'toolPolicy.activePreset' });
		expect(Object.keys((presetRow.control as any).options)).toEqual(Object.values(PolicyPreset));

		const group = page.items?.[1] as SettingDefinitionGroup;
		expect(group.type).toBe('group');
		expect(group.search).toBeDefined();

		// First item in the group is the filter-pills render row (searchable: false).
		const pillsRow = group.items?.[0] as SettingDefinitionRender;
		expect(pillsRow.searchable).toBe(false);
		expect(typeof pillsRow.render).toBe('function');

		// Tools are sorted by name and each carries a dropdown control keyed to
		// its own toolPolicy.toolPermissions.<name> path, plus search aliases.
		const toolRows = group.items?.slice(1) as SettingDefinitionControl[];
		expect(toolRows.map((r) => r.name)).toEqual(['read_file', 'write_file']);
		expect(toolRows[0].control).toMatchObject({ type: 'dropdown', key: 'toolPolicy.toolPermissions.read_file' });
		expect(toolRows[0].aliases).toContain('read_file');
	});

	it('reports the active preset label as the page displayValue', () => {
		const plugin = makePlugin();
		plugin.settings.toolPolicy.activePreset = PolicyPreset.YOLO;
		const page = toolPermissionsPage(makeCtx(plugin));
		expect(typeof page.displayValue).toBe('function');
		expect((page.displayValue as () => string)()).toMatch(/yolo|YOLO/i);
	});
});

describe('matchesFilter', () => {
	const mcpTool = makeTool({ name: 'mcp__github__create_issue', classification: ToolClassification.EXTERNAL });
	const writeTool = makeTool({ name: 'write_file', classification: ToolClassification.WRITE });

	it('"all" matches everything', () => {
		expect(matchesFilter(writeTool, 'all')).toBe(true);
		expect(matchesFilter(mcpTool, 'all')).toBe(true);
	});

	it('classification filters match only that classification', () => {
		expect(matchesFilter(writeTool, ToolClassification.WRITE)).toBe(true);
		expect(matchesFilter(writeTool, ToolClassification.READ)).toBe(false);
	});

	it('"mcp" matches only mcp__-prefixed tool names', () => {
		expect(matchesFilter(mcpTool, 'mcp')).toBe(true);
		expect(matchesFilter(writeTool, 'mcp')).toBe(false);
	});
});

describe('TOOL_POLICY_WRITERS["toolPolicy.activePreset"]', () => {
	it('rejects an unknown preset value without mutating settings', async () => {
		const plugin = makePlugin();
		const result = await TOOL_POLICY_WRITERS['toolPolicy.activePreset'](
			plugin,
			'toolPolicy.activePreset',
			'not-a-preset'
		);
		expect(result).toEqual({ needsUpdate: false });
		expect(plugin.settings.toolPolicy.activePreset).toBe(PolicyPreset.CAUTIOUS);
	});

	it('switching to a named preset clears per-tool overrides', async () => {
		const plugin = makePlugin();
		plugin.settings.toolPolicy.toolPermissions = { read_file: ToolPermission.DENY };
		const result = await TOOL_POLICY_WRITERS['toolPolicy.activePreset'](
			plugin,
			'toolPolicy.activePreset',
			PolicyPreset.READ_ONLY
		);
		expect(result).toEqual({ needsUpdate: true });
		expect(plugin.settings.toolPolicy.activePreset).toBe(PolicyPreset.READ_ONLY);
		expect(plugin.settings.toolPolicy.toolPermissions).toEqual({});
	});

	it("switching to CUSTOM materializes every tool's current effective permission", async () => {
		const tools = [makeTool({ name: 'a' }), makeTool({ name: 'b', classification: ToolClassification.WRITE })];
		const plugin = makePlugin(tools);
		const result = await TOOL_POLICY_WRITERS['toolPolicy.activePreset'](
			plugin,
			'toolPolicy.activePreset',
			PolicyPreset.CUSTOM
		);
		expect(result).toEqual({ needsUpdate: true });
		expect(plugin.settings.toolPolicy.activePreset).toBe(PolicyPreset.CUSTOM);
		expect(Object.keys(plugin.settings.toolPolicy.toolPermissions).sort()).toEqual(['a', 'b']);
	});

	it('YOLO requires confirmation and rejects the write on decline', async () => {
		yoloConfirmResult.value = false;
		const plugin = makePlugin();
		const result = await TOOL_POLICY_WRITERS['toolPolicy.activePreset'](
			plugin,
			'toolPolicy.activePreset',
			PolicyPreset.YOLO
		);
		expect(result).toEqual({ needsUpdate: false });
		expect(plugin.settings.toolPolicy.activePreset).toBe(PolicyPreset.CAUTIOUS);
	});

	it('YOLO proceeds once confirmed', async () => {
		yoloConfirmResult.value = true;
		const plugin = makePlugin();
		const result = await TOOL_POLICY_WRITERS['toolPolicy.activePreset'](
			plugin,
			'toolPolicy.activePreset',
			PolicyPreset.YOLO
		);
		expect(result).toEqual({ needsUpdate: true });
		expect(plugin.settings.toolPolicy.activePreset).toBe(PolicyPreset.YOLO);
	});

	it('treats a failure to load the confirmation modal as a decline', async () => {
		yoloConfirmResult.threw = true;
		const plugin = makePlugin();
		const result = await TOOL_POLICY_WRITERS['toolPolicy.activePreset'](
			plugin,
			'toolPolicy.activePreset',
			PolicyPreset.YOLO
		);
		expect(result).toEqual({ needsUpdate: false });
		expect(plugin.settings.toolPolicy.activePreset).toBe(PolicyPreset.CAUTIOUS);
		expect(plugin.logger.error).toHaveBeenCalled();
	});
});

describe('TOOL_POLICY_WRITERS["toolPolicy.toolPermissions.*"]', () => {
	it('ignores an unknown tool name', async () => {
		const plugin = makePlugin();
		const result = await TOOL_POLICY_WRITERS['toolPolicy.toolPermissions.*'](
			plugin,
			'toolPolicy.toolPermissions.does_not_exist',
			ToolPermission.DENY
		);
		expect(result).toEqual({ needsUpdate: false });
	});

	it('removes the override when the new value matches the preset default', async () => {
		const plugin = makePlugin([makeTool({ name: 'read_file', classification: ToolClassification.READ })]);
		plugin.settings.toolPolicy.activePreset = PolicyPreset.CAUTIOUS; // READ -> APPROVE under Cautious
		plugin.settings.toolPolicy.toolPermissions = { read_file: ToolPermission.DENY };
		const result = await TOOL_POLICY_WRITERS['toolPolicy.toolPermissions.*'](
			plugin,
			'toolPolicy.toolPermissions.read_file',
			ToolPermission.APPROVE
		);
		expect(result).toEqual({ needsUpdate: false });
		expect(plugin.settings.toolPolicy.toolPermissions).toEqual({});
	});

	it('materializes to CUSTOM on first override, then only updates that tool afterwards', async () => {
		const tools = [
			makeTool({ name: 'read_file', classification: ToolClassification.READ }),
			makeTool({ name: 'write_file', classification: ToolClassification.WRITE }),
		];
		const plugin = makePlugin(tools);
		plugin.settings.toolPolicy.activePreset = PolicyPreset.CAUTIOUS;

		const first = await TOOL_POLICY_WRITERS['toolPolicy.toolPermissions.*'](
			plugin,
			'toolPolicy.toolPermissions.write_file',
			ToolPermission.DENY
		);
		expect(first).toEqual({ needsUpdate: true });
		expect(plugin.settings.toolPolicy.activePreset).toBe(PolicyPreset.CUSTOM);
		expect(plugin.settings.toolPolicy.toolPermissions.write_file).toBe(ToolPermission.DENY);
		expect(plugin.settings.toolPolicy.toolPermissions.read_file).toBeDefined();

		const second = await TOOL_POLICY_WRITERS['toolPolicy.toolPermissions.*'](
			plugin,
			'toolPolicy.toolPermissions.read_file',
			ToolPermission.DENY
		);
		expect(second).toEqual({ needsUpdate: false });
		expect(plugin.settings.toolPolicy.toolPermissions.read_file).toBe(ToolPermission.DENY);
	});
});

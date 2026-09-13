import { Notice } from 'obsidian';
import type { SettingDefinitionPage, SettingDefinitionRender, SettingDefinitionControl } from 'obsidian';
import {
	ToolPermission,
	ToolClassification,
	PolicyPreset,
	PRESET_LABELS,
	PERMISSION_LABELS,
	CLASSIFICATION_LABELS,
	PRESET_PERMISSIONS,
} from '../../types/tool-policy';
import type { Tool } from '../../tools/types';
import { getErrorMessage } from '../../utils/error-utils';
import { t, type TranslationKey } from '../../i18n';
import type { SettingsContext, SettingWriter } from './context';

type ToolFilter = 'all' | ToolClassification | 'mcp';

const FILTER_OPTIONS: { key: ToolFilter; labelKey: TranslationKey }[] = [
	{ key: 'all', labelKey: 'settings.tools.filterAll' },
	{ key: ToolClassification.READ, labelKey: 'settings.tools.filterRead' },
	{ key: ToolClassification.WRITE, labelKey: 'settings.tools.filterWrite' },
	{ key: ToolClassification.DESTRUCTIVE, labelKey: 'settings.tools.filterDestructive' },
	{ key: ToolClassification.EXTERNAL, labelKey: 'settings.tools.filterExternal' },
	{ key: 'mcp', labelKey: 'settings.tools.filterMcp' },
];

/**
 * Transient view state: which pill is active. Deliberately module-local and
 * never persisted — same treatment the design doc gives it (§7), the
 * opposite of the old `expandedSettingsSections` mistake.
 */
let activeFilter: ToolFilter = 'all';

/** MCP tools are named `mcp__<server>__<tool>` (`src/mcp/mcp-tool-wrapper.ts`). */
function isMcpTool(tool: Tool): boolean {
	return tool.name.startsWith('mcp__');
}

export function matchesFilter(tool: Tool, filter: ToolFilter): boolean {
	if (filter === 'all') return true;
	if (filter === 'mcp') return isMcpTool(tool);
	return tool.classification === filter;
}

/** Test-only: reset the module-local filter state between test cases. */
export function _resetActiveFilterForTests(): void {
	activeFilter = 'all';
}

/**
 * Tool permissions settings page (settings-redesign design doc §7).
 *
 * Ex-`settings-tools.ts`'s four classification-grouped `SettingGroup`s,
 * collapsed into one searchable group with filter pills over per-tool
 * dropdown rows. The preset/custom transition logic moves verbatim into
 * `TOOL_POLICY_WRITERS`, DOM-free and unit-testable on its own.
 */
export function toolPermissionsPage(ctx: SettingsContext): SettingDefinitionPage {
	const { plugin } = ctx;
	const allTools = plugin.toolRegistry?.getAllTools() ?? [];

	if (allTools.length === 0) {
		return {
			type: 'page',
			name: t('settings.main.toolPermissionsName'),
			items: [{ name: t('settings.tools.noToolsName'), desc: t('settings.tools.noToolsDesc') }],
		};
	}

	const sortedTools = [...allTools].sort((a, b) => a.name.localeCompare(b.name));

	const toolItems: SettingDefinitionControl[] = sortedTools.map((tool) => ({
		name: tool.displayName || tool.name,
		desc: tool.description,
		aliases: [tool.name, t(CLASSIFICATION_LABELS[tool.classification])],
		visible: () => matchesFilter(tool, activeFilter),
		control: {
			type: 'dropdown',
			key: `toolPolicy.toolPermissions.${tool.name}`,
			options: Object.fromEntries(Object.values(ToolPermission).map((perm) => [perm, t(PERMISSION_LABELS[perm])])),
		},
	}));

	return {
		type: 'page',
		name: t('settings.main.toolPermissionsName'),
		displayValue: () => t(PRESET_LABELS[plugin.settings.toolPolicy.activePreset]),
		items: [
			{
				name: t('settings.tools.presetName'),
				desc: t('settings.tools.presetDesc'),
				control: {
					type: 'dropdown',
					key: 'toolPolicy.activePreset',
					options: Object.fromEntries(Object.values(PolicyPreset).map((preset) => [preset, t(PRESET_LABELS[preset])])),
				},
			},
			{
				type: 'group',
				heading: t('settings.tools.toolsHeading'),
				search: {
					placeholder: t('settings.tools.filterPlaceholder'),
					match: (def, query) => {
						const needle = query.trim().toLowerCase();
						if (!needle) return true;
						if (def.name.toLowerCase().includes(needle)) return true;
						return (def.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle));
					},
				},
				items: [filterPillsRow(ctx), ...toolItems],
			},
		],
	};
}

function filterPillsRow(ctx: SettingsContext): SettingDefinitionRender {
	return {
		name: t('settings.tools.filterRowName'),
		searchable: false,
		render: (setting) => {
			setting.controlEl.classList.add('gemini-tool-filter-pills');
			for (const option of FILTER_OPTIONS) {
				const pill = setting.controlEl.createEl('button', {
					cls: 'gemini-tool-filter-pill',
					text: t(option.labelKey),
				});
				pill.type = 'button';
				pill.classList.toggle('is-active', activeFilter === option.key);
				pill.addEventListener('click', () => {
					activeFilter = option.key;
					for (const sibling of Array.from(setting.controlEl.querySelectorAll('.gemini-tool-filter-pill'))) {
						sibling.classList.remove('is-active');
					}
					pill.classList.add('is-active');
					ctx.tab.refreshDomState();
				});
			}
		},
	};
}

/**
 * Writers for `toolPolicy.*` paths — the preset/custom materialize-and-clear
 * logic lifted verbatim out of the deleted `settings-tools.ts`, now DOM-free
 * (settings-redesign design doc §5.2/§7). WP2 merges these into its own
 * `SETTING_WRITERS` map.
 */
export const TOOL_POLICY_WRITERS: Record<string, SettingWriter> = {
	'toolPolicy.activePreset': async (plugin, _key, value) => {
		const candidate = value as PolicyPreset;
		if (!(Object.values(PolicyPreset) as string[]).includes(candidate)) {
			return { needsUpdate: false };
		}

		if (candidate === PolicyPreset.YOLO) {
			const confirmed = await confirmYolo(plugin);
			if (!confirmed) return { needsUpdate: false };
		}

		const allTools = plugin.toolRegistry?.getAllTools() ?? [];
		if (candidate === PolicyPreset.CUSTOM) {
			plugin.settings.toolPolicy.toolPermissions = Object.fromEntries(
				allTools.map((tool) => [tool.name, plugin.toolRegistry.getEffectivePermission(tool.name)])
			);
			plugin.settings.toolPolicy.activePreset = PolicyPreset.CUSTOM;
		} else {
			plugin.settings.toolPolicy.activePreset = candidate;
			plugin.settings.toolPolicy.toolPermissions = {};
		}
		return { needsUpdate: true };
	},

	'toolPolicy.toolPermissions.*': async (plugin, key, value) => {
		const toolName = key.slice('toolPolicy.toolPermissions.'.length);
		const targetTool = plugin.toolRegistry?.getTool(toolName);
		if (!targetTool) return { needsUpdate: false };

		const newPerm = value as ToolPermission;
		const policy = plugin.settings.toolPolicy;
		const presetDefault =
			policy.activePreset === PolicyPreset.CUSTOM
				? undefined
				: PRESET_PERMISSIONS[policy.activePreset][targetTool.classification];

		if (newPerm === presetDefault) {
			delete policy.toolPermissions[toolName];
			return { needsUpdate: false };
		}

		let switchedPreset = false;
		if (policy.activePreset !== PolicyPreset.CUSTOM) {
			const allTools = plugin.toolRegistry?.getAllTools() ?? [];
			policy.toolPermissions = Object.fromEntries(
				allTools.map((tool) => [tool.name, plugin.toolRegistry.getEffectivePermission(tool.name)])
			);
			policy.activePreset = PolicyPreset.CUSTOM;
			switchedPreset = true;
		}
		policy.toolPermissions[toolName] = newPerm;
		return { needsUpdate: switchedPreset };
	},
};

async function confirmYolo(plugin: SettingsContext['plugin']): Promise<boolean> {
	try {
		const { YoloConfirmationModal } = await import('../yolo-confirmation-modal');
		return await new Promise((resolve) => {
			new YoloConfirmationModal(plugin.app, (confirmed: boolean) => resolve(confirmed)).open();
		});
	} catch (error) {
		// If the confirmation modal itself can't load, treat that as a decline
		// rather than silently enabling YOLO.
		plugin.logger.error('Failed to load YOLO confirmation modal:', error);
		new Notice(t('settings.tools.yoloConfirmFailed', { error: getErrorMessage(error) }));
		return false;
	}
}

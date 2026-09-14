import type { SettingDefinitionPage } from 'obsidian';
import { t } from '../../i18n';
import type { SettingsContext } from './context';

/**
 * Advanced settings sub-page (settings-redesign design doc §5.4).
 *
 * Ex-`settings-agent-config.ts` / `settings-debug.ts`: everything from those
 * two deleted collapsible sections that survives the sweep (temperature,
 * top-p, retries, the Interactions API toggle, and loop-detection tuning are
 * all removed — see AGENTS.md's settings-redesign sweep notes). One unnamed
 * group for context/tool-error/frontmatter-key/logging, one "Diagnostics"
 * group for debug-facing toggles.
 */
export function advancedPage(ctx: SettingsContext): SettingDefinitionPage {
	const { plugin } = ctx;
	return {
		type: 'page',
		name: t('settings.main.advancedName'),
		items: [
			{
				type: 'group',
				items: [
					{
						name: t('settings.advanced.compactionThresholdName'),
						desc: t('settings.advanced.compactionThresholdDesc'),
						control: {
							type: 'slider',
							key: 'contextCompactionThreshold',
							min: 5,
							max: 50,
							step: 5,
							displayFormat: (value: number) => `${value}%`,
						},
					},
					{
						name: t('settings.advanced.stopOnToolErrorName'),
						desc: t('settings.advanced.stopOnToolErrorDesc'),
						control: { type: 'toggle', key: 'stopOnToolError' },
					},
					{
						name: t('settings.advanced.summaryFrontmatterKeyName'),
						desc: t('settings.advanced.summaryFrontmatterKeyDesc'),
						control: { type: 'text', key: 'summaryFrontmatterKey' },
					},
					{
						name: t('settings.advanced.logToolExecutionName'),
						desc: t('settings.advanced.logToolExecutionDesc'),
						control: {
							type: 'toggle',
							key: 'logToolExecution',
							disabled: () => !plugin.settings.chatHistory,
						},
					},
				],
			},
			{
				type: 'group',
				heading: t('settings.advanced.diagnosticsHeading'),
				items: [
					{
						name: t('settings.advanced.debugModeName'),
						desc: t('settings.advanced.debugModeDesc'),
						control: { type: 'toggle', key: 'debugMode' },
					},
					{
						name: t('settings.advanced.showTokenUsageName'),
						desc: t('settings.advanced.showTokenUsageDesc'),
						control: { type: 'toggle', key: 'showTokenUsage' },
					},
					{
						name: t('settings.advanced.logToFileName'),
						desc: t('settings.advanced.logToFileDesc'),
						control: { type: 'toggle', key: 'fileLogging' },
					},
				],
			},
		],
	};
}

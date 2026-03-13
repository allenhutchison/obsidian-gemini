/**
 * Tool permission and policy system.
 *
 * Provides granular per-tool permissions (DENY / ASK_USER / APPROVE) with
 * named presets that replace the legacy binary "Trusted Mode" toggle.
 */

/**
 * Permission state for an individual tool.
 *
 * - DENY: Tool is not loaded into the registry; the AI cannot use it.
 * - ASK_USER: Tool is available but requires user confirmation before each execution.
 * - APPROVE: Tool executes immediately without confirmation.
 */
export enum ToolPermission {
	DENY = 'deny',
	ASK_USER = 'ask_user',
	APPROVE = 'approve',
}

/**
 * Classification of a tool by its risk profile.
 * Each tool declares one of these; presets map classifications to permissions.
 */
export enum ToolClassification {
	/** Read-only operations (search, read, analyze) */
	READ = 'read',
	/** Content-creation / modification operations */
	WRITE = 'write',
	/** Irreversible or high-risk operations (delete, move) */
	DESTRUCTIVE = 'destructive',
	/** External API calls or long-running tasks */
	EXTERNAL = 'external',
}

/**
 * Named permission presets.
 */
export enum PolicyPreset {
	READ_ONLY = 'read_only',
	CAUTIOUS = 'cautious',
	EDIT_MODE = 'edit_mode',
	YOLO = 'yolo',
	CUSTOM = 'custom',
}

/**
 * Settings structure persisted for the tool policy system.
 */
export interface ToolPolicySettings {
	/** Active preset name */
	activePreset: PolicyPreset;

	/** Per-tool permission overrides (tool name → permission) */
	toolPermissions: Record<string, ToolPermission>;
}

/**
 * Default policy settings (Cautious mode).
 */
export const DEFAULT_TOOL_POLICY: ToolPolicySettings = {
	activePreset: PolicyPreset.CAUTIOUS,
	toolPermissions: {},
};

/**
 * Maps a ToolClassification to its permission under each preset.
 */
export const PRESET_PERMISSIONS: Record<PolicyPreset, Record<ToolClassification, ToolPermission>> = {
	[PolicyPreset.READ_ONLY]: {
		[ToolClassification.READ]: ToolPermission.APPROVE,
		[ToolClassification.WRITE]: ToolPermission.DENY,
		[ToolClassification.DESTRUCTIVE]: ToolPermission.DENY,
		[ToolClassification.EXTERNAL]: ToolPermission.DENY,
	},
	[PolicyPreset.CAUTIOUS]: {
		[ToolClassification.READ]: ToolPermission.APPROVE,
		[ToolClassification.WRITE]: ToolPermission.ASK_USER,
		[ToolClassification.DESTRUCTIVE]: ToolPermission.ASK_USER,
		[ToolClassification.EXTERNAL]: ToolPermission.ASK_USER,
	},
	[PolicyPreset.EDIT_MODE]: {
		[ToolClassification.READ]: ToolPermission.APPROVE,
		[ToolClassification.WRITE]: ToolPermission.APPROVE,
		[ToolClassification.DESTRUCTIVE]: ToolPermission.ASK_USER,
		[ToolClassification.EXTERNAL]: ToolPermission.ASK_USER,
	},
	[PolicyPreset.YOLO]: {
		[ToolClassification.READ]: ToolPermission.APPROVE,
		[ToolClassification.WRITE]: ToolPermission.APPROVE,
		[ToolClassification.DESTRUCTIVE]: ToolPermission.APPROVE,
		[ToolClassification.EXTERNAL]: ToolPermission.APPROVE,
	},
	[PolicyPreset.CUSTOM]: {
		// Custom has no fixed mapping; it's driven entirely by toolPermissions.
		// This entry exists for type-safety; it is never used for resolution.
		[ToolClassification.READ]: ToolPermission.APPROVE,
		[ToolClassification.WRITE]: ToolPermission.ASK_USER,
		[ToolClassification.DESTRUCTIVE]: ToolPermission.ASK_USER,
		[ToolClassification.EXTERNAL]: ToolPermission.ASK_USER,
	},
};

/**
 * Human-friendly labels for presets (for settings UI).
 */
export const PRESET_LABELS: Record<PolicyPreset, string> = {
	[PolicyPreset.READ_ONLY]: 'Read Only',
	[PolicyPreset.CAUTIOUS]: 'Cautious (Default)',
	[PolicyPreset.EDIT_MODE]: 'Edit Mode',
	[PolicyPreset.YOLO]: 'YOLO Mode',
	[PolicyPreset.CUSTOM]: 'Custom',
};

/**
 * Human-friendly labels for permissions (for settings UI dropdowns).
 */
export const PERMISSION_LABELS: Record<ToolPermission, string> = {
	[ToolPermission.DENY]: 'Deny',
	[ToolPermission.ASK_USER]: 'Ask User',
	[ToolPermission.APPROVE]: 'Approve',
};

/**
 * Human-friendly labels for classifications (for settings UI section headers).
 */
export const CLASSIFICATION_LABELS: Record<ToolClassification, string> = {
	[ToolClassification.READ]: 'Read Tools',
	[ToolClassification.WRITE]: 'Write Tools',
	[ToolClassification.DESTRUCTIVE]: 'Destructive Tools',
	[ToolClassification.EXTERNAL]: 'External Tools',
};

/**
 * Build the full toolPermissions map for a given preset based on a list of registered tools.
 *
 * @param preset - The preset to generate permissions for.
 * @param tools - Array of objects with `name` and `classification` properties.
 * @returns A complete toolPermissions record.
 */
export function buildPermissionsForPreset(
	preset: PolicyPreset,
	tools: Array<{ name: string; classification: ToolClassification }>
): Record<string, ToolPermission> {
	const presetMap = PRESET_PERMISSIONS[preset];
	const permissions: Record<string, ToolPermission> = {};

	for (const tool of tools) {
		permissions[tool.name] = presetMap[tool.classification];
	}

	return permissions;
}

/**
 * Resolve the effective permission for a tool given the current policy settings
 * and the tool's classification.
 *
 * Resolution order:
 * 1. Explicit per-tool override in `settings.toolPermissions`
 * 2. Preset-defined permission based on tool classification
 *
 * @param toolName - The tool's registered name.
 * @param classification - The tool's classification (read/write/destructive/external).
 * @param settings - The current tool policy settings.
 * @returns The effective ToolPermission for this tool.
 */
export function resolvePermission(
	toolName: string,
	classification: ToolClassification,
	settings: ToolPolicySettings
): ToolPermission {
	// Check for explicit per-tool override
	const override = settings.toolPermissions[toolName];
	if (override !== undefined) {
		return override;
	}

	// Fall back to preset-defined permission
	return PRESET_PERMISSIONS[settings.activePreset][classification];
}

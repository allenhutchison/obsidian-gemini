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

/**
 * Per-feature tool policy. Lets a Project, Scheduled Task, Hook, or Session
 * narrow (or open up) the global tool policy for the duration of one run.
 *
 * When `preset` is unset the feature inherits the global active preset; when
 * `overrides` is unset (or missing a tool entry) the feature inherits the
 * global per-tool overrides.
 */
export interface FeatureToolPolicy {
	preset?: PolicyPreset;
	overrides?: Record<string, ToolPermission>;
}

/**
 * Resolve the effective permission for a tool, layering a feature-level
 * policy on top of the global policy.
 *
 * Resolution order (most specific wins):
 *   1. Feature `overrides[toolName]`
 *   2. Global `toolPermissions[toolName]`
 *   3. Feature `preset[classification]`
 *   4. Global `activePreset[classification]`
 */
export function resolveEffectivePermission(
	toolName: string,
	classification: ToolClassification,
	global: ToolPolicySettings,
	feature?: FeatureToolPolicy
): ToolPermission {
	if (feature?.overrides && feature.overrides[toolName] !== undefined) {
		return feature.overrides[toolName];
	}
	const globalOverride = global.toolPermissions[toolName];
	if (globalOverride !== undefined) {
		return globalOverride;
	}
	if (feature?.preset !== undefined && feature.preset !== PolicyPreset.CUSTOM) {
		return PRESET_PERMISSIONS[feature.preset][classification];
	}
	return PRESET_PERMISSIONS[global.activePreset][classification];
}

/**
 * Map of user-facing permission strings to ToolPermission enum values.
 * Used by YAML frontmatter parsers in project / scheduled-task / hook configs.
 *
 * - `allow` and `approve` both map to APPROVE (project frontmatter has historically used `allow`)
 * - `ask` and `ask_user` both map to ASK_USER
 * - `deny` maps to DENY
 */
export const PERMISSION_STRING_MAP: Record<string, ToolPermission> = {
	allow: ToolPermission.APPROVE,
	approve: ToolPermission.APPROVE,
	deny: ToolPermission.DENY,
	ask: ToolPermission.ASK_USER,
	ask_user: ToolPermission.ASK_USER,
};

/**
 * Reverse map: ToolPermission enum values back to preferred YAML strings.
 * APPROVE serializes as `allow` (shorter, matches the legacy project format).
 */
const PERMISSION_TO_STRING: Record<ToolPermission, string> = {
	[ToolPermission.APPROVE]: 'allow',
	[ToolPermission.DENY]: 'deny',
	[ToolPermission.ASK_USER]: 'ask',
};

/**
 * Parse a raw frontmatter value into a FeatureToolPolicy, or return undefined
 * when the input doesn't look like a policy block (inherit-global semantics).
 *
 * Accepts shapes like:
 *   { preset: 'read_only' }
 *   { overrides: { read_file: 'allow', delete_file: 'deny' } }
 *   { preset: 'cautious', overrides: { web_fetch: 'deny' } }
 *
 * Returns undefined for null/undefined input.
 */
export function parseToolPolicyFrontmatter(raw: unknown): FeatureToolPolicy | undefined {
	if (raw === null || raw === undefined) return undefined;
	if (typeof raw !== 'object') return undefined;

	const obj = raw as Record<string, unknown>;
	const policy: FeatureToolPolicy = {};

	if (typeof obj.preset === 'string') {
		const presetCandidate = obj.preset.toLowerCase();
		if ((Object.values(PolicyPreset) as string[]).includes(presetCandidate)) {
			policy.preset = presetCandidate as PolicyPreset;
		}
	}

	if (obj.overrides && typeof obj.overrides === 'object') {
		const overrides: Record<string, ToolPermission> = {};
		for (const [tool, value] of Object.entries(obj.overrides as Record<string, unknown>)) {
			if (typeof value !== 'string') continue;
			const mapped = PERMISSION_STRING_MAP[value.toLowerCase()];
			if (mapped !== undefined) {
				overrides[tool] = mapped;
			}
		}
		if (Object.keys(overrides).length > 0) {
			policy.overrides = overrides;
		}
	}

	if (policy.preset === undefined && policy.overrides === undefined) {
		return undefined;
	}
	return policy;
}

/**
 * Deep-clone a FeatureToolPolicy. Used by SessionManager and friends to avoid
 * sharing nested `overrides` references with the static DEFAULT_CONTEXTS.
 */
export function clonePolicy(policy: FeatureToolPolicy | undefined): FeatureToolPolicy | undefined {
	if (!policy) return undefined;
	return {
		...(policy.preset !== undefined ? { preset: policy.preset } : {}),
		...(policy.overrides ? { overrides: { ...policy.overrides } } : {}),
	};
}

/**
 * Serialize a FeatureToolPolicy back to a plain frontmatter-friendly object.
 * Returns undefined when the policy is effectively empty.
 */
export function serializeToolPolicy(policy: FeatureToolPolicy | undefined): Record<string, unknown> | undefined {
	if (!policy) return undefined;
	const out: Record<string, unknown> = {};
	if (policy.preset !== undefined) {
		out.preset = policy.preset;
	}
	if (policy.overrides && Object.keys(policy.overrides).length > 0) {
		const overrides: Record<string, string> = {};
		for (const [tool, perm] of Object.entries(policy.overrides)) {
			overrides[tool] = PERMISSION_TO_STRING[perm];
		}
		out.overrides = overrides;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

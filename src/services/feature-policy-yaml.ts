import { FeatureToolPolicy, PolicyPreset, serializeToolPolicy } from '../types/tool-policy';

/**
 * Translate a legacy `enabledTools` category array (the pre-unified-policy
 * shape used by scheduled tasks and hooks) into a FeatureToolPolicy.
 *
 * The legacy modal also wrote two values that never matched a real
 * ToolCategory — `read_write` and `destructive` — so those are folded into
 * the closest preset rather than discarded silently.
 *
 * Returns `undefined` for an empty / unrecognisable input, which the loader
 * treats as "inherit the global policy".
 */
export function migrateLegacyToolCategoryArray(raw: unknown): FeatureToolPolicy | undefined {
	if (!Array.isArray(raw)) return undefined;
	const set = new Set(raw.filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase()));
	if (set.size === 0) return undefined;

	const hasReadOnly = set.has('read_only');
	const hasVaultOps = set.has('vault_ops') || set.has('read_write');
	const hasDestructive = set.has('destructive');
	const hasExternal = set.has('external_mcp') || set.has('system');

	// If the legacy list essentially asked for everything, inherit the global
	// policy instead of locking the user into a specific preset.
	if (hasExternal || (hasReadOnly && hasVaultOps && hasDestructive)) {
		return undefined;
	}
	if (hasDestructive) return { preset: PolicyPreset.YOLO };
	if (hasVaultOps) return { preset: PolicyPreset.EDIT_MODE };
	if (hasReadOnly) return { preset: PolicyPreset.READ_ONLY };
	return undefined;
}

/**
 * Render a FeatureToolPolicy as YAML block lines suitable for hand-rolled
 * frontmatter writers (scheduled tasks, hooks). Returns `null` when the
 * policy is empty so the caller can omit the field entirely.
 *
 * Output shape:
 *   toolPolicy:
 *     preset: read_only
 *     overrides:
 *       write_file: deny
 */
export function formatToolPolicyYaml(policy: FeatureToolPolicy | undefined): string[] | null {
	const serialized = serializeToolPolicy(policy);
	if (!serialized) return null;

	const lines: string[] = ['toolPolicy:'];
	if (typeof serialized.preset === 'string') {
		lines.push(`  preset: ${serialized.preset}`);
	}
	const overrides = serialized.overrides as Record<string, string> | undefined;
	if (overrides && Object.keys(overrides).length > 0) {
		lines.push('  overrides:');
		for (const [tool, perm] of Object.entries(overrides)) {
			lines.push(`    ${tool}: ${perm}`);
		}
	}
	return lines;
}

import {
	ToolPermission,
	ToolClassification,
	PolicyPreset,
	PRESET_PERMISSIONS,
	PRESET_LABELS,
	PERMISSION_LABELS,
	CLASSIFICATION_LABELS,
	DEFAULT_TOOL_POLICY,
	resolvePermission,
	resolveEffectivePermission,
	buildPermissionsForPreset,
	parseToolPolicyFrontmatter,
	serializeToolPolicy,
	clonePolicy,
	FeatureToolPolicy,
	ToolPolicySettings,
} from '../../src/types/tool-policy';

describe('tool-policy types', () => {
	describe('enums', () => {
		it('should define all ToolPermission values', () => {
			expect(ToolPermission.DENY).toBe('deny');
			expect(ToolPermission.ASK_USER).toBe('ask_user');
			expect(ToolPermission.APPROVE).toBe('approve');
		});

		it('should define all ToolClassification values', () => {
			expect(ToolClassification.READ).toBe('read');
			expect(ToolClassification.WRITE).toBe('write');
			expect(ToolClassification.DESTRUCTIVE).toBe('destructive');
			expect(ToolClassification.EXTERNAL).toBe('external');
		});

		it('should define all PolicyPreset values', () => {
			expect(PolicyPreset.READ_ONLY).toBe('read_only');
			expect(PolicyPreset.CAUTIOUS).toBe('cautious');
			expect(PolicyPreset.EDIT_MODE).toBe('edit_mode');
			expect(PolicyPreset.YOLO).toBe('yolo');
			expect(PolicyPreset.CUSTOM).toBe('custom');
		});
	});

	describe('PRESET_PERMISSIONS', () => {
		it('READ_ONLY should only approve READ tools', () => {
			const p = PRESET_PERMISSIONS[PolicyPreset.READ_ONLY];
			expect(p[ToolClassification.READ]).toBe(ToolPermission.APPROVE);
			expect(p[ToolClassification.WRITE]).toBe(ToolPermission.DENY);
			expect(p[ToolClassification.DESTRUCTIVE]).toBe(ToolPermission.DENY);
			expect(p[ToolClassification.EXTERNAL]).toBe(ToolPermission.DENY);
		});

		it('CAUTIOUS should approve READ and ask for everything else', () => {
			const p = PRESET_PERMISSIONS[PolicyPreset.CAUTIOUS];
			expect(p[ToolClassification.READ]).toBe(ToolPermission.APPROVE);
			expect(p[ToolClassification.WRITE]).toBe(ToolPermission.ASK_USER);
			expect(p[ToolClassification.DESTRUCTIVE]).toBe(ToolPermission.ASK_USER);
			expect(p[ToolClassification.EXTERNAL]).toBe(ToolPermission.ASK_USER);
		});

		it('EDIT_MODE should approve READ and WRITE, ask for DESTRUCTIVE and EXTERNAL', () => {
			const p = PRESET_PERMISSIONS[PolicyPreset.EDIT_MODE];
			expect(p[ToolClassification.READ]).toBe(ToolPermission.APPROVE);
			expect(p[ToolClassification.WRITE]).toBe(ToolPermission.APPROVE);
			expect(p[ToolClassification.DESTRUCTIVE]).toBe(ToolPermission.ASK_USER);
			expect(p[ToolClassification.EXTERNAL]).toBe(ToolPermission.ASK_USER);
		});

		it('YOLO should approve everything', () => {
			const p = PRESET_PERMISSIONS[PolicyPreset.YOLO];
			expect(p[ToolClassification.READ]).toBe(ToolPermission.APPROVE);
			expect(p[ToolClassification.WRITE]).toBe(ToolPermission.APPROVE);
			expect(p[ToolClassification.DESTRUCTIVE]).toBe(ToolPermission.APPROVE);
			expect(p[ToolClassification.EXTERNAL]).toBe(ToolPermission.APPROVE);
		});
	});

	describe('labels', () => {
		it('should have labels for all presets', () => {
			for (const preset of Object.values(PolicyPreset)) {
				expect(PRESET_LABELS[preset]).toBeDefined();
				expect(typeof PRESET_LABELS[preset]).toBe('string');
			}
		});

		it('should have labels for all permissions', () => {
			for (const perm of Object.values(ToolPermission)) {
				expect(PERMISSION_LABELS[perm]).toBeDefined();
			}
		});

		it('should have labels for all classifications', () => {
			for (const cls of Object.values(ToolClassification)) {
				expect(CLASSIFICATION_LABELS[cls]).toBeDefined();
			}
		});
	});

	describe('DEFAULT_TOOL_POLICY', () => {
		it('should default to CAUTIOUS preset with no overrides', () => {
			expect(DEFAULT_TOOL_POLICY.activePreset).toBe(PolicyPreset.CAUTIOUS);
			expect(DEFAULT_TOOL_POLICY.toolPermissions).toEqual({});
		});
	});

	describe('resolvePermission', () => {
		it('should return preset default when no override exists', () => {
			const settings: ToolPolicySettings = {
				activePreset: PolicyPreset.CAUTIOUS,
				toolPermissions: {},
			};
			expect(resolvePermission('read_file', ToolClassification.READ, settings)).toBe(ToolPermission.APPROVE);
			expect(resolvePermission('write_file', ToolClassification.WRITE, settings)).toBe(ToolPermission.ASK_USER);
		});

		it('should return per-tool override when it exists', () => {
			const settings: ToolPolicySettings = {
				activePreset: PolicyPreset.CAUTIOUS,
				toolPermissions: {
					write_file: ToolPermission.APPROVE,
				},
			};
			// Override takes precedence
			expect(resolvePermission('write_file', ToolClassification.WRITE, settings)).toBe(ToolPermission.APPROVE);
			// Non-overridden tool still uses preset
			expect(resolvePermission('delete_file', ToolClassification.DESTRUCTIVE, settings)).toBe(ToolPermission.ASK_USER);
		});

		it('should use DENY override even if preset would approve', () => {
			const settings: ToolPolicySettings = {
				activePreset: PolicyPreset.YOLO,
				toolPermissions: {
					delete_file: ToolPermission.DENY,
				},
			};
			expect(resolvePermission('delete_file', ToolClassification.DESTRUCTIVE, settings)).toBe(ToolPermission.DENY);
		});

		it('should respect different presets', () => {
			const readOnly: ToolPolicySettings = {
				activePreset: PolicyPreset.READ_ONLY,
				toolPermissions: {},
			};
			expect(resolvePermission('write_file', ToolClassification.WRITE, readOnly)).toBe(ToolPermission.DENY);

			const editMode: ToolPolicySettings = {
				activePreset: PolicyPreset.EDIT_MODE,
				toolPermissions: {},
			};
			expect(resolvePermission('write_file', ToolClassification.WRITE, editMode)).toBe(ToolPermission.APPROVE);
		});
	});

	describe('buildPermissionsForPreset', () => {
		const tools = [
			{ name: 'read_file', classification: ToolClassification.READ },
			{ name: 'write_file', classification: ToolClassification.WRITE },
			{ name: 'delete_file', classification: ToolClassification.DESTRUCTIVE },
			{ name: 'google_search', classification: ToolClassification.EXTERNAL },
		];

		it('should map all tools to their preset permissions', () => {
			const result = buildPermissionsForPreset(PolicyPreset.CAUTIOUS, tools);
			expect(result).toEqual({
				read_file: ToolPermission.APPROVE,
				write_file: ToolPermission.ASK_USER,
				delete_file: ToolPermission.ASK_USER,
				google_search: ToolPermission.ASK_USER,
			});
		});

		it('should produce all APPROVE for YOLO preset', () => {
			const result = buildPermissionsForPreset(PolicyPreset.YOLO, tools);
			for (const perm of Object.values(result)) {
				expect(perm).toBe(ToolPermission.APPROVE);
			}
		});

		it('should produce DENY for write/destructive/external in READ_ONLY', () => {
			const result = buildPermissionsForPreset(PolicyPreset.READ_ONLY, tools);
			expect(result.read_file).toBe(ToolPermission.APPROVE);
			expect(result.write_file).toBe(ToolPermission.DENY);
			expect(result.delete_file).toBe(ToolPermission.DENY);
			expect(result.google_search).toBe(ToolPermission.DENY);
		});

		it('should return empty object for empty tool list', () => {
			const result = buildPermissionsForPreset(PolicyPreset.CAUTIOUS, []);
			expect(result).toEqual({});
		});
	});

	// ── Unified feature-level policy helpers ────────────────────────────────

	describe('resolveEffectivePermission', () => {
		const global = (extra: Partial<ToolPolicySettings> = {}): ToolPolicySettings => ({
			activePreset: PolicyPreset.CAUTIOUS,
			toolPermissions: {},
			...extra,
		});

		it('feature overrides win over every other layer', () => {
			const settings = global({
				toolPermissions: { write_file: ToolPermission.DENY },
			});
			const feature: FeatureToolPolicy = {
				overrides: { write_file: ToolPermission.APPROVE },
			};
			expect(resolveEffectivePermission('write_file', ToolClassification.WRITE, settings, feature)).toBe(
				ToolPermission.APPROVE
			);
		});

		it('global overrides win over feature preset', () => {
			const settings = global({
				toolPermissions: { write_file: ToolPermission.DENY },
			});
			const feature: FeatureToolPolicy = { preset: PolicyPreset.EDIT_MODE };
			expect(resolveEffectivePermission('write_file', ToolClassification.WRITE, settings, feature)).toBe(
				ToolPermission.DENY
			);
		});

		it('feature preset wins over global preset', () => {
			// CAUTIOUS would map WRITE → ASK_USER; READ_ONLY maps it to DENY.
			const feature: FeatureToolPolicy = { preset: PolicyPreset.READ_ONLY };
			expect(resolveEffectivePermission('write_file', ToolClassification.WRITE, global(), feature)).toBe(
				ToolPermission.DENY
			);
		});

		it('inherits global preset when no feature policy is supplied', () => {
			expect(resolveEffectivePermission('read_file', ToolClassification.READ, global())).toBe(ToolPermission.APPROVE);
			expect(resolveEffectivePermission('delete_file', ToolClassification.DESTRUCTIVE, global())).toBe(
				ToolPermission.ASK_USER
			);
		});

		it('feature CUSTOM preset is treated as "no preset contribution"', () => {
			const feature: FeatureToolPolicy = { preset: PolicyPreset.CUSTOM };
			expect(resolveEffectivePermission('write_file', ToolClassification.WRITE, global(), feature)).toBe(
				ToolPermission.ASK_USER
			);
		});
	});

	describe('parseToolPolicyFrontmatter', () => {
		it('returns undefined for null/undefined input', () => {
			expect(parseToolPolicyFrontmatter(null)).toBeUndefined();
			expect(parseToolPolicyFrontmatter(undefined)).toBeUndefined();
		});

		it('parses a preset-only block', () => {
			expect(parseToolPolicyFrontmatter({ preset: 'read_only' })).toEqual({
				preset: PolicyPreset.READ_ONLY,
			});
		});

		it('parses overrides via the YAML permission strings', () => {
			expect(
				parseToolPolicyFrontmatter({
					overrides: { write_file: 'allow', delete_file: 'deny', move_file: 'ask' },
				})
			).toEqual({
				overrides: {
					write_file: ToolPermission.APPROVE,
					delete_file: ToolPermission.DENY,
					move_file: ToolPermission.ASK_USER,
				},
			});
		});

		it('drops unknown preset values', () => {
			expect(parseToolPolicyFrontmatter({ preset: 'made_up' })).toBeUndefined();
		});

		it('drops unknown override values without throwing', () => {
			expect(
				parseToolPolicyFrontmatter({
					overrides: { ok: 'allow', bad: 'lolwut' },
				})
			).toEqual({ overrides: { ok: ToolPermission.APPROVE } });
		});
	});

	describe('serializeToolPolicy', () => {
		it('round-trips through parseToolPolicyFrontmatter', () => {
			const original: FeatureToolPolicy = {
				preset: PolicyPreset.EDIT_MODE,
				overrides: { write_file: ToolPermission.DENY },
			};
			expect(parseToolPolicyFrontmatter(serializeToolPolicy(original))).toEqual(original);
		});

		it('returns undefined for an empty policy', () => {
			expect(serializeToolPolicy(undefined)).toBeUndefined();
			expect(serializeToolPolicy({})).toBeUndefined();
			expect(serializeToolPolicy({ overrides: {} })).toBeUndefined();
		});
	});

	describe('clonePolicy', () => {
		it('deep-clones overrides so mutations do not alias the source', () => {
			const source: FeatureToolPolicy = {
				preset: PolicyPreset.READ_ONLY,
				overrides: { write_file: ToolPermission.DENY },
			};
			const clone = clonePolicy(source)!;
			clone.overrides!.write_file = ToolPermission.APPROVE;
			expect(source.overrides!.write_file).toBe(ToolPermission.DENY);
		});

		it('returns undefined for undefined input', () => {
			expect(clonePolicy(undefined)).toBeUndefined();
		});
	});
});

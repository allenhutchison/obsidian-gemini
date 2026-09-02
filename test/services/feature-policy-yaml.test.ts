import { PolicyPreset, ToolPermission } from '../../src/types/tool-policy';
import { migrateLegacyToolCategoryArray, formatToolPolicyYaml } from '../../src/services/feature-policy-yaml';

describe('feature-policy-yaml service', () => {
	describe('migrateLegacyToolCategoryArray', () => {
		it('read_only only ⇒ READ_ONLY preset', () => {
			expect(migrateLegacyToolCategoryArray(['read_only'])).toEqual({
				preset: PolicyPreset.READ_ONLY,
			});
		});

		it('read_only + vault_ops ⇒ EDIT_MODE preset', () => {
			expect(migrateLegacyToolCategoryArray(['read_only', 'vault_ops'])).toEqual({
				preset: PolicyPreset.EDIT_MODE,
			});
		});

		it('bugged read_write string maps to EDIT_MODE (treated as vault_ops)', () => {
			expect(migrateLegacyToolCategoryArray(['read_only', 'read_write'])).toEqual({
				preset: PolicyPreset.EDIT_MODE,
			});
		});

		it('bugged destructive string maps to YOLO preset', () => {
			expect(migrateLegacyToolCategoryArray(['read_only', 'destructive'])).toEqual({
				preset: PolicyPreset.YOLO,
			});
		});

		it('full default-agent list ⇒ inherit global', () => {
			expect(migrateLegacyToolCategoryArray(['read_only', 'vault_ops', 'external_mcp', 'skills'])).toBeUndefined();
		});

		it('empty / non-array input ⇒ undefined', () => {
			expect(migrateLegacyToolCategoryArray([])).toBeUndefined();
			expect(migrateLegacyToolCategoryArray(null)).toBeUndefined();
			expect(migrateLegacyToolCategoryArray('read_only')).toBeUndefined();
		});
	});

	describe('formatToolPolicyYaml', () => {
		it('renders a preset + overrides block', () => {
			expect(
				formatToolPolicyYaml({
					preset: PolicyPreset.READ_ONLY,
					overrides: { write_file: ToolPermission.DENY },
				})
			).toEqual(['toolPolicy:', '  preset: read_only', '  overrides:', "    'write_file': deny"]);
		});

		it('renders a preset without overrides', () => {
			expect(
				formatToolPolicyYaml({
					preset: PolicyPreset.READ_ONLY,
				})
			).toEqual(['toolPolicy:', '  preset: read_only']);
		});

		it('renders overrides without preset', () => {
			expect(
				formatToolPolicyYaml({
					overrides: { write_file: ToolPermission.DENY },
				})
			).toEqual(['toolPolicy:', '  overrides:', "    'write_file': deny"]);
		});

		it('quotes an override key so an MCP tool name cannot break the block', () => {
			// MCP tool names reach here through `sanitizeName`, which permits `:`
			// and `.`. They are not a closed union, so the key goes through the
			// shared string emitter rather than relying on that regex staying
			// strict. The permission is a ToolPermission member and stays raw.
			expect(
				formatToolPolicyYaml({
					overrides: { "mcp:server's tool": ToolPermission.DENY },
				})
			).toEqual(['toolPolicy:', '  overrides:', "    'mcp:server''s tool': deny"]);
		});

		it('returns null for an empty policy so callers can omit the field', () => {
			expect(formatToolPolicyYaml(undefined)).toBeNull();
			expect(formatToolPolicyYaml({})).toBeNull();
			expect(formatToolPolicyYaml({ overrides: {} })).toBeNull();
		});
	});
});

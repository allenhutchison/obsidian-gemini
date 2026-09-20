import { describe, expect, it } from 'vitest';
import { FEATURE_SLUG_MAX, validateFeatureSlug } from '../../src/utils/feature-slug';

describe('validateFeatureSlug', () => {
	const valid = (raw: string, opts?: { requireLeadingLetter?: boolean }) => validateFeatureSlug(raw, opts).valid;

	it('accepts plain kebab-case slugs', () => {
		expect(valid('daily-digest')).toBe(true);
		expect(valid('a')).toBe(true);
		expect(valid('2fa-cleanup')).toBe(true); // leading digit: fine for hooks/tasks
		expect(valid('v2')).toBe(true);
	});

	it('rejects empty and whitespace-only input', () => {
		expect(validateFeatureSlug('')).toMatchObject({ valid: false, error: 'cannot be empty' });
		expect(validateFeatureSlug('   ')).toMatchObject({ valid: false, error: 'cannot be empty' });
	});

	it('rejects outer whitespace on an otherwise valid slug', () => {
		// Callers use the original value as a file basename (createSkill builds
		// the directory from the untrimmed name), so the validator must not
		// silently trim it into compliance.
		expect(valid(' daily-digest ')).toBe(false);
		expect(valid('daily-digest ')).toBe(false);
		expect(valid(' daily-digest', { requireLeadingLetter: true })).toBe(false);
	});

	it('rejects path separators and .. traversal', () => {
		expect(valid('sub/dir')).toBe(false);
		expect(valid('sub\\dir')).toBe(false);
		expect(valid('..')).toBe(false);
		expect(valid('a/../b')).toBe(false);
		expect(valid('a/b..')).toBe(false);
	});

	it('rejects hyphen rule violations', () => {
		expect(valid('-hidden')).toBe(false);
		expect(valid('hidden-')).toBe(false);
		expect(valid('a--b')).toBe(false);
		expect(valid('-')).toBe(false);
	});

	it('rejects non-conforming characters', () => {
		expect(valid('My Slug')).toBe(false);
		expect(valid('slüg')).toBe(false);
		expect(valid('slüg2')).toBe(false);
		expect(valid('a_b')).toBe(false);
	});

	it('enforces the length bound at both ends', () => {
		const ok = 'a'.repeat(FEATURE_SLUG_MAX);
		const tooLong = 'a'.repeat(FEATURE_SLUG_MAX + 1);
		expect(ok.length).toBe(FEATURE_SLUG_MAX);
		expect(valid(ok)).toBe(true);
		expect(validateFeatureSlug(tooLong)).toMatchObject({
			valid: false,
			error: `must be at most ${FEATURE_SLUG_MAX} characters`,
		});
	});

	describe('requireLeadingLetter (agentskills.io skill contract)', () => {
		it('rejects leading digits and hyphens', () => {
			expect(valid('2fa-cleanup', { requireLeadingLetter: true })).toBe(false);
			expect(valid('3d-render', { requireLeadingLetter: true })).toBe(false);
			expect(validateFeatureSlug('2fa-cleanup', { requireLeadingLetter: true })).toMatchObject({
				valid: false,
				error: 'must start with a lowercase letter',
			});
		});

		it('accepts letter-leading slugs and single letters', () => {
			expect(valid('cleanup', { requireLeadingLetter: true })).toBe(true);
			expect(valid('a', { requireLeadingLetter: true })).toBe(true);
			expect(valid('x9-task', { requireLeadingLetter: true })).toBe(true);
		});

		it('keeps the shared rules under both modes', () => {
			expect(valid('--x', { requireLeadingLetter: true })).toBe(false);
			expect(valid('a--b', { requireLeadingLetter: true })).toBe(false);
			expect(valid('sub/dir', { requireLeadingLetter: true })).toBe(false);
		});
	});
});

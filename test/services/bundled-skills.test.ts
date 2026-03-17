import { BundledSkillRegistry } from '../../src/services/bundled-skills';

describe('BundledSkillRegistry', () => {
	describe('getSummaries', () => {
		it('should return summaries for all bundled skills', () => {
			const summaries = BundledSkillRegistry.getSummaries();
			expect(summaries.length).toBeGreaterThan(0);
			for (const summary of summaries) {
				expect(summary.name).toBeTruthy();
				expect(summary.description).toBeTruthy();
			}
		});

		it('should include gemini-scribe-help skill', () => {
			const summaries = BundledSkillRegistry.getSummaries();
			const help = summaries.find((s) => s.name === 'gemini-scribe-help');
			expect(help).toBeDefined();
			expect(help!.description).toBeTruthy();
		});

		it('should include obsidian-bases skill', () => {
			const summaries = BundledSkillRegistry.getSummaries();
			const bases = summaries.find((s) => s.name === 'obsidian-bases');
			expect(bases).toBeDefined();
			expect(bases!.description).toBeTruthy();
		});
	});

	describe('loadSkill', () => {
		it('should return body content for gemini-scribe-help', () => {
			const content = BundledSkillRegistry.loadSkill('gemini-scribe-help');
			expect(content).not.toBeNull();
			expect(content).toContain('Gemini Scribe');
		});

		it('should return body content for obsidian-bases', () => {
			const content = BundledSkillRegistry.loadSkill('obsidian-bases');
			expect(content).not.toBeNull();
			expect(content).toContain('Bases');
		});

		it('should return null for unknown skill', () => {
			expect(BundledSkillRegistry.loadSkill('nonexistent')).toBeNull();
		});

		it('should not include frontmatter in body content', () => {
			const content = BundledSkillRegistry.loadSkill('gemini-scribe-help');
			expect(content).not.toMatch(/^---\r?\n/);
		});
	});

	describe('readResource', () => {
		it('should return content for a valid help skill reference', () => {
			const content = BundledSkillRegistry.readResource('gemini-scribe-help', 'references/agent-mode.md');
			expect(content).not.toBeNull();
			expect(content!.length).toBeGreaterThan(0);
		});

		it('should return null for unknown resource', () => {
			expect(BundledSkillRegistry.readResource('gemini-scribe-help', 'references/nonexistent.md')).toBeNull();
		});

		it('should return null for unknown skill', () => {
			expect(BundledSkillRegistry.readResource('nonexistent', 'references/foo.md')).toBeNull();
		});
	});

	describe('listResources', () => {
		it('should list references for gemini-scribe-help', () => {
			const resources = BundledSkillRegistry.listResources('gemini-scribe-help');
			expect(resources.length).toBeGreaterThan(0);
			expect(resources).toContain('references/agent-mode.md');
			expect(resources).toContain('references/settings.md');
		});

		it('should return empty array for skill with no resources', () => {
			const resources = BundledSkillRegistry.listResources('obsidian-bases');
			expect(resources).toEqual([]);
		});

		it('should return empty array for unknown skill', () => {
			expect(BundledSkillRegistry.listResources('nonexistent')).toEqual([]);
		});
	});

	describe('has', () => {
		it('should return true for bundled skills', () => {
			expect(BundledSkillRegistry.has('gemini-scribe-help')).toBe(true);
			expect(BundledSkillRegistry.has('obsidian-bases')).toBe(true);
		});

		it('should return false for unknown skills', () => {
			expect(BundledSkillRegistry.has('nonexistent')).toBe(false);
		});
	});
});
